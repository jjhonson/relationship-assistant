import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decryptSnapshot, documentDigest, encryptSnapshot, validateStore } from "./recovery-crypto.mjs";
import { readRemoteSnapshot, restoreToEmptyDataset, writeNewPrivateFile } from "./relationship-recovery.mjs";

const sourceProjectUrl = "https://fictional-source.supabase.co";
const destProjectUrl = "https://fresh-destination.supabase.co";
const sourceOwner = "11111111-1111-4111-8111-111111111111";
const restoreOwner = "22222222-2222-4222-8222-222222222222";
const personId = "33333333-3333-4333-8333-333333333333";
const captureId = "44444444-4444-4444-8444-444444444444";
const momentId = "55555555-5555-4555-8555-555555555555";
const journeyId = "66666666-6666-4666-8666-666666666666";
const passphrase = "long-private-passphrase-for-recovery-tests-only";

const fixture = {
  version: 1,
  relationships: [{
    id: personId,
    personLabel: "Fictional Judy",
    lastInteractionAt: "2026-11-23",
    sources: [{ id: "capture:" + captureId, label: "Fictional running conversation", observedAt: "2026-11-22" }],
    durableFacts: [{ id: "fact:running", category: "Interest", value: "Considering a December 5K",
      sourceIds: ["capture:" + captureId] }],
    actionableMemoryFeedback: [{ id: "decision:fictional", disposition: "Edit",
      originalText: "Already ran the race", replacement: { text: "Might run it" },
      sourceIds: ["capture:" + captureId] }],
    dismissedConnectionCandidates: [{ basisId: "fictional-idea", sourceIds: ["capture:" + captureId] }],
  }],
  captures: [{ id: captureId, summary: "Fictional chat; raw transcript excluded" }],
  moments: [{ id: momentId, description: "Read a fictional article", consideration: "private" }],
  connectionJourneys: [{
    id: journeyId, relationshipId: personId,
    basisSourceIds: ["capture:" + captureId],
    events: [{ id: "77777777-7777-4777-8777-777777777777", kind: "reply_received",
      outcome: "Still considering a 5K" }],
  }],
  unknownFutureRootProperty: { retained: true },
};

function snapshot(overrides = {}) {
  return { ownerId: sourceOwner, sourceProjectUrl, revision: 2, document: structuredClone(fixture), ...overrides };
}

function encrypted(overrides = {}) {
  return encryptSnapshot(snapshot(overrides), passphrase);
}

test("encrypted backup round-trips all four collections, source evidence, corrections, and unknown fields", () => {
  const ciphertext = encrypted();
  assert.ok(!ciphertext.includes("Fictional Judy"));
  assert.ok(!ciphertext.includes(personId));
  assert.ok(!ciphertext.includes("capture:"));
  const clear = decryptSnapshot(ciphertext, passphrase);
  assert.deepEqual(clear.document, fixture);
  assert.equal(clear.sourceProjectUrl, sourceProjectUrl);
  assert.equal(clear.sourceOwnerId, sourceOwner);
  assert.equal(clear.revision, 2);
  assert.equal(clear.documentSha256, documentDigest(fixture));
});

test("hash comparison is independent of object key order but respects array order", () => {
  const reordered = JSON.parse(JSON.stringify(fixture));
  const first = reordered.relationships[0];
  reordered.relationships[0] = { personLabel: first.personLabel, ...first };
  assert.equal(documentDigest(fixture), documentDigest(reordered));
  const reversed = { ...fixture, relationships: [...fixture.relationships, {
    id: "88888888-8888-4888-8888-888888888888", personLabel: "Fictional Tom"
  }] };
  assert.notEqual(documentDigest(fixture), documentDigest(reversed));
});

test("incorrect passphrase and tampered encrypted content fail authentication", () => {
  const original = encrypted();
  assert.throws(() => decryptSnapshot(original, "this-is-a-wrong-passphrase"), /authentication failed/i);
  const edited = JSON.parse(original);
  const letters = edited.ciphertext;
  edited.ciphertext = (letters[0] === "A" ? "B" : "A") + letters.slice(1);
  assert.throws(() => decryptSnapshot(JSON.stringify(edited), passphrase), /authentication failed/i);
  const changedTag = JSON.parse(original);
  changedTag.cipher.tag = "AAAAAAAAAAAAAAAAAAAAAA==";
  assert.throws(() => decryptSnapshot(JSON.stringify(changedTag), passphrase), /authentication failed/i);
});

test("invalid schema, duplicate record IDs, broken relationships, oversized inputs rejected", () => {
  assert.throws(() => validateStore({ version: 2, relationships: [] }), /Unsupported/);
  const duplicate = structuredClone(fixture);
  duplicate.moments.push({ ...duplicate.moments[0] });
  assert.throws(() => validateStore(duplicate), /duplicate record/);
  const orphan = structuredClone(fixture);
  orphan.connectionJourneys[0].relationshipId = restoreOwner;
  assert.throws(() => validateStore(orphan), /missing relationship/);
  assert.throws(() => encryptSnapshot(snapshot({ sourceProjectUrl: "https://evil.test" }), passphrase), /Invalid source/);
  const malformed = JSON.parse(encrypted());
  malformed.kdf.N = 64;
  assert.throws(() => decryptSnapshot(JSON.stringify(malformed), passphrase), /modified backup format/);
  assert.throws(() => decryptSnapshot("x".repeat(33 * 1024 * 1024), passphrase), /oversized backup/);
});

function fakeSupabase() {
  const projects = new Map([
    [sourceProjectUrl, new Map([[sourceOwner, { revision: 2, document: structuredClone(fixture) }]])],
    [destProjectUrl, new Map()],
  ]);
  const requests = [];
  const send = async (url, init) => {
    const endpoint = url.split("/rest/v1/rpc/")[0];
    const name = url.split("/rest/v1/rpc/")[1];
    const body = JSON.parse(init.body);
    requests.push({ endpoint, name, body });
    const store = projects.get(endpoint);
    if (!store) return new Response(JSON.stringify({ code: "404" }), { status: 404 });
    if (name === "ra_store_read") {
      return new Response(JSON.stringify(store.get(body.p_owner_id) ?? null), { status: 200 });
    }
    if (name === "ra_store_write") {
      if (store.has(body.p_owner_id)) {
        return new Response(JSON.stringify({ code: "23505" }), { status: 409 });
      }
      if (body.p_expected_revision !== -1) {
        return new Response(JSON.stringify({ code: "40001" }), { status: 409 });
      }
      store.set(body.p_owner_id, { revision: 0, document: structuredClone(body.p_document) });
      return new Response("0", { status: 200 });
    }
    return new Response(JSON.stringify({ code: "404" }), { status: 404 });
  };
  return { projects, requests, send };
}

test("separate-project restore re-reads and verifies exact source records", async () => {
  const server = fakeSupabase();
  const original = await readRemoteSnapshot({ base: sourceProjectUrl, key: "sb_secret_fictional" }, sourceOwner, server.send);
  const backup = decryptSnapshot(encryptSnapshot(original, passphrase), passphrase);
  const restored = await restoreToEmptyDataset({ base: destProjectUrl, key: "sb_secret_fictional" },
    restoreOwner, backup, server.send);
  assert.deepEqual(restored, { ownerId: restoreOwner, sourceRevision: 2, verified: true });
  assert.deepEqual(server.projects.get(destProjectUrl).get(restoreOwner).document, fixture);
  assert.equal(server.projects.get(destProjectUrl).get(restoreOwner).revision, 0);
  assert.equal(server.projects.get(sourceProjectUrl).get(sourceOwner).revision, 2);
  assert.equal(server.requests.filter((x) => x.name === "ra_store_write").length, 1);
  await assert.rejects(
    restoreToEmptyDataset({ base: destProjectUrl, key: "sb_secret_fictional" }, restoreOwner, backup, server.send),
    /Refusing to overwrite/
  );
});

test("refuses same-project recovery and same owner ID before any writes", async () => {
  const server = fakeSupabase();
  const backup = decryptSnapshot(encrypted(), passphrase);
  await assert.rejects(
    restoreToEmptyDataset({ base: sourceProjectUrl, key: "sb_secret_fictional" }, restoreOwner, backup, server.send),
    /different Supabase project/
  );
  await assert.rejects(
    restoreToEmptyDataset({ base: destProjectUrl, key: "sb_secret_fictional" }, sourceOwner, backup, server.send),
    /distinct.*dataset UUID/
  );
  assert.equal(server.requests.length, 0);
});

test("encrypted backup file is private and never silently overwritten", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ra-recovery-test-"));
  const path = join(dir, "test-backup.raenc");
  try {
    const data = encrypted();
    assert.equal(await writeNewPrivateFile(path, data), path);
    assert.equal(await readFile(path, "utf8"), data);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(writeNewPrivateFile(path, "replacement"), /nothing was overwritten/);
    assert.equal(await readFile(path, "utf8"), data);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
