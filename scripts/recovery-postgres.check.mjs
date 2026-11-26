#!/usr/bin/env node
/**
 * Disposable two-instance PostgreSQL recovery drill. Synthetic data only.
 * Each port belongs to a different fresh postgres:17 service container.
 * The test does not connect to the user's Supabase project or use secrets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { decryptSnapshot, documentDigest, encryptSnapshot } from "./recovery-crypto.mjs";
import { restoreIntoDisposablePostgres, writeNewPrivateFile } from "./relationship-recovery.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sourcePort = 5432;
const targetPort = 5433;
const sourceOwner = "11111111-1111-4111-8111-111111111111";
const recoveryOwner = "22222222-2222-4222-8222-222222222222";
const brokenOwner = "99999999-9999-4999-8999-999999999999";
const personId = "33333333-3333-4333-8333-333333333333";
const captureId = "44444444-4444-4444-8444-444444444444";
const momentId = "55555555-5555-4555-8555-555555555555";
const journeyId = "66666666-6666-4666-8666-666666666666";
const passphrase = "synthetic-ci-only-not-a-user-recovery-passphrase";

const fixture = {
  version: 1,
  relationships: [{
    id: personId, personLabel: "Fictional Judy", lastInteractionAt: "2026-11-25",
    sources: [
      { id: "capture:" + captureId, observedAt: "2026-11-25", label: "User-authored note" },
      { id: "pasted:fictional-1", observedAt: "2026-11-24", label: "Pasted chat, transcript excluded" },
    ],
    durableFacts: [{ id: "fact:fictional-running", category: "Interest",
      value: "Considering a beginner running group", sourceIds: ["capture:" + captureId] }],
    correctionHistory: [{ id: "edit:fictional", before: "Ran a race", after: "Considering a race" }],
    dismissedConnectionCandidates: [{ id: "dismissed:fictional", reason: "not useful" }],
  }],
  captures: [{ id: captureId, note: "My own fictional conversation note", reportedInteractionAt: "2026-11-25" }],
  moments: [{ id: momentId, description: "Read an invented article", consideration: "private" }],
  connectionJourneys: [{
    id: journeyId, relationshipId: personId,
    events: [{ id: "77777777-7777-4777-8777-777777777777",
      kind: "connection_sent", text: "Fictional outreach" }],
  }],
  unknownFutureRootProperty: { preserved: true },
};

function psql(port, extraArgs) {
  const args = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
    "-p", String(port), "-U", "postgres", "-d", "postgres", ...extraArgs];
  return execFileSync("psql", args, {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: process.env.POSTGRES_TEST_PASSWORD ?? "ci-fixture-only" },
    stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  }).trim();
}
function sql(port, statement) {
  return psql(port, ["-c", statement]);
}
function sqlJson(value) {
  // The only values passed here are deliberately constructed synthetic test data.
  return "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
}
function read(port, owner) {
  const raw = sql(port, "select public.ra_store_read('" + owner + "'::uuid);");
  return raw ? JSON.parse(raw) : null;
}
function write(port, owner, expectedRevision, document) {
  return Number(sql(port, "select public.ra_store_write('" + owner +
    "'::uuid, " + expectedRevision + ", " + sqlJson(document) + ");"));
}
function initialize(port) {
  sql(port, "create role anon; create role authenticated; create role service_role bypassrls;");
  psql(port, ["-f", "supabase/migrations/20261124235124_relationship_agent_private_json_v1_bridge.sql"]);
  psql(port, ["-f", "supabase/migrations/20261125154752_relationship_agent_atomic_server_gateway.sql"]);
}

test("encrypted export restores into a different fresh PostgreSQL instance", () => {
  initialize(sourcePort);
  initialize(targetPort);

  const deny = sql(targetPort, "select " +
    "has_function_privilege('anon','public.ra_store_read(uuid)','EXECUTE')," +
    "has_function_privilege('authenticated','public.ra_store_write(uuid,bigint,jsonb)','EXECUTE')," +
    "has_table_privilege('anon','ra_private.relationships','SELECT')," +
    "has_table_privilege('service_role','ra_private.relationships','SELECT');");
  assert.equal(deny, "f|f|f|t", "non-server roles must not read or write");

  // The original lives in the first PostgreSQL server, not a namespace on the destination.
  assert.equal(write(sourcePort, sourceOwner, -1, fixture), 0);
  const source = read(sourcePort, sourceOwner);
  assert.ok(source);
  assert.equal(source.revision, 0);
  assert.equal(documentDigest(source.document), documentDigest(fixture));

  const encrypted = encryptSnapshot({
    ownerId: sourceOwner, revision: source.revision, document: source.document,
    sourceProjectUrl: "https://fictional-original.supabase.co",
  }, passphrase);
  assert.ok(!encrypted.includes("Fictional Judy"));
  assert.ok(!encrypted.includes(personId));
  assert.throws(() => decryptSnapshot(encrypted, "incorrect-synthetic-passphrase"),
    /authentication failed/i);
  const tampered = JSON.parse(encrypted);
  tampered.ciphertext = (tampered.ciphertext[0] === "A" ? "B" : "A") +
    tampered.ciphertext.slice(1);
  assert.throws(() => decryptSnapshot(JSON.stringify(tampered), passphrase),
    /authentication failed/i);
  assert.equal(read(targetPort, recoveryOwner), null,
    "failed decrypt must not create a destination");

  const recovered = decryptSnapshot(encrypted, passphrase);
  assert.equal(recovered.revision, 0);
  assert.equal(recovered.sourceOwnerId, sourceOwner);
  assert.equal(recovered.documentSha256, documentDigest(fixture));
  assert.equal(write(targetPort, recoveryOwner, -1, recovered.document), 0);

  const destination = read(targetPort, recoveryOwner);
  assert.ok(destination);
  assert.equal(destination.revision, 0);
  assert.equal(documentDigest(destination.document), documentDigest(fixture));
  assert.deepEqual(destination.document, source.document,
    "every ID, source, correction, collection and unknown field must survive");

  assert.throws(() => write(targetPort, recoveryOwner, -1, fixture),
    /duplicate|already exists/i, "occupied destination must refuse overwrite");
  assert.equal(documentDigest(read(targetPort, recoveryOwner).document), documentDigest(fixture));
  const orphan = structuredClone(fixture);
  orphan.connectionJourneys[0].relationshipId = brokenOwner;
  assert.throws(() => write(targetPort, brokenOwner, -1, orphan),
    /foreign key|violates/i, "corrupt references must roll back");
  assert.equal(read(targetPort, brokenOwner), null,
    "invalid restoration must not leave a partial dataset");
  assert.deepEqual(read(sourcePort, sourceOwner).document, source.document,
    "source remains unchanged after all recovery operations");
});


test("private-file recovery path restores an actual encrypted fixture file in isolated Docker", async () => {
  const folder = await mkdtemp(join(tmpdir(), "ra-recovery-fixture-"));
  try {
    const backup = encryptSnapshot({
      ownerId: sourceOwner, revision: 9, document: fixture,
      sourceProjectUrl: "https://fictional-original.supabase.co",
    }, passphrase);
    const file = await writeNewPrivateFile(join(folder, "synthetic.raenc"), backup);
    const downloaded = await readFile(file);
    assert.throws(() => decryptSnapshot(downloaded, "incorrect-synthetic-passphrase"),
      /authentication failed/i);
    const verified = await restoreIntoDisposablePostgres(decryptSnapshot(downloaded, passphrase));
    assert.deepEqual(verified, {
      verified: true, sourceRevision: 9, documentSha256: documentDigest(fixture),
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
