#!/usr/bin/env node
/**
 * Explicit, server-side export / inspect / restore for a private dataset.
 * Does not use browser keys or Supabase CLI and never changes application mode.
 * Backups are not independent until the encrypted file leaves the Codespace.
 */
import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decryptSnapshot, documentDigest, encryptSnapshot, isUuid } from "./recovery-crypto.mjs";

function endpoint(url, secret) {
  if (typeof url !== "string" || typeof secret !== "string" ||
      !/^sb_secret_[A-Za-z0-9_-]+$/.test(secret)) {
    throw new Error("A private Supabase project URL and server-only secret key are required.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)) {
    throw new Error("Invalid private Supabase project address.");
  }
  return { base: parsed.origin, key: secret };
}

export async function rpc(config, name, input, send = fetch) {
  if (!["ra_store_read", "ra_store_write"].includes(name)) throw new Error("Unsupported storage operation.");
  let response;
  try {
    response = await send(config.base + "/rest/v1/rpc/" + name, {
      method: "POST", cache: "no-store",
      headers: { apikey: config.key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Database request failed. No backup or restore was confirmed.");
  }
  if (!response.ok) {
    let code = "";
    try { code = (await response.json())?.code ?? ""; } catch { /* No provider error logging. */ }
    if (code === "23505" || code === "40001") {
      throw new Error("Restore refused: destination already exists or was changed.");
    }
    throw new Error("Database rejected the private storage request. No success was confirmed.");
  }
  try { return await response.json(); }
  catch { throw new Error("Database returned an invalid storage response."); }
}

export async function readRemoteSnapshot(config, ownerId, send = fetch) {
  if (!isUuid(ownerId)) throw new Error("Invalid source dataset identifier.");
  const response = await rpc(config, "ra_store_read", { p_owner_id: ownerId }, send);
  if (!response) throw new Error("Source dataset does not exist; nothing to back up.");
  if (!Number.isSafeInteger(response.revision) || response.revision < 0 ||
      !response.document || response.document.version !== 1) {
    throw new Error("Source dataset response is invalid.");
  }
  // Validates supported collection shapes before backup.
  documentDigest(response.document);
  return { ownerId, sourceProjectUrl: config.base, revision: response.revision, document: response.document };
}

export async function restoreToEmptyDataset(config, targetOwnerId, backup, send = fetch) {
  if (config.base === backup.sourceProjectUrl) {
    throw new Error("Independent recovery requires a different Supabase project.");
  }
  if (!isUuid(targetOwnerId) || targetOwnerId === backup.sourceOwnerId) {
    throw new Error("A distinct, valid destination dataset UUID is required.");
  }
  const digest = documentDigest(backup.document);
  if (digest !== backup.documentSha256) {
    throw new Error("Recovery snapshot failed integrity verification.");
  }
  const present = await rpc(config, "ra_store_read", { p_owner_id: targetOwnerId }, send);
  if (present !== null) {
    throw new Error("Refusing to overwrite a non-empty recovery destination.");
  }
  const result = await rpc(config, "ra_store_write", {
    p_owner_id: targetOwnerId,
    p_expected_revision: -1,
    p_document: backup.document,
  }, send);
  if (result !== 0) {
    throw new Error("Recovery write was not confirmed; inspect destination before retrying.");
  }
  const verified = await rpc(config, "ra_store_read", { p_owner_id: targetOwnerId }, send);
  if (!verified || verified.revision !== 0 ||
      documentDigest(verified.document) !== digest) {
    throw new Error("Restoration verification failed; do not use the recovered dataset.");
  }
  return { ownerId: targetOwnerId, sourceRevision: backup.revision, verified: true };
}

/** Refuses overwrite and restricts permissions. A failed write removes its partial file. */
export async function writeNewPrivateFile(path, contents) {
  const target = resolve(path);
  let file;
  try {
    file = await open(target, "wx", 0o600);
    await file.writeFile(contents, { encoding: "utf8" });
    await file.sync();
  } catch {
    if (file) {
      await file.close().catch(() => undefined);
      await unlink(target).catch(() => undefined);
    }
    throw new Error("Unable to create new encrypted backup file; nothing was overwritten.");
  }
  await file.close();
  return target;
}

async function hiddenPassphrase(label) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Private interactive terminal required to enter a backup passphrase.");
  }
  process.stderr.write(label);
  return new Promise((resolveInput, reject) => {
    const previous = Boolean(input.isRaw);
    let value = "";
    let finished = false;
    function finish(error) {
      if (finished) return;
      finished = true;
      input.removeListener("data", onData);
      input.setRawMode(previous);
      input.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolveInput(value);
    }
    function onData(data) {
      for (const ch of String(data)) {
        if (ch === "\u0003") return finish(new Error("Cancelled."));
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\b" || ch === "\u007f") value = value.slice(0, -1);
        else if (ch >= " " && value.length < 1024) value += ch;
      }
    }
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function argsFor(command, list) {
  const allowed = command === "backup" ? ["--output"] :
    command === "verify" ? ["--input"] :
    command === "restore" ? ["--input", "--target-owner"] : [];
  if (!allowed.length || list.length !== allowed.length * 2) {
    throw new Error("Usage: backup --output FILE | verify --input FILE | restore --input FILE --target-owner UUID");
  }
  const args = {};
  for (let i = 0; i < list.length; i += 2) {
    if (!allowed.includes(list[i]) || args[list[i]] !== undefined ||
        !list[i+1] || list[i+1].startsWith("--")) {
      throw new Error("Invalid or duplicate recovery argument.");
    }
    args[list[i]] = list[i+1];
  }
  if (allowed.some((flag) => !args[flag])) throw new Error("Missing recovery argument.");
  return args;
}

export async function main(command = process.argv[2], rest = process.argv.slice(3)) {
  const args = argsFor(command, rest);
  if (command === "backup") {
    const source = endpoint(process.env.RA_SUPABASE_URL, process.env.RA_SUPABASE_SECRET_KEY);
    const snapshot = await readRemoteSnapshot(source, process.env.RA_DB_OWNER_ID);
    const passphrase = await hiddenPassphrase("New backup passphrase (not echoed): ");
    const confirmation = await hiddenPassphrase("Confirm backup passphrase (not echoed): ");
    if (passphrase !== confirmation) throw new Error("Backup passphrase confirmation did not match.");
    const encoded = encryptSnapshot(snapshot, passphrase);
    const saved = await writeNewPrivateFile(args["--output"], encoded);
    process.stdout.write("Encrypted backup created: " + saved +
      "\nIMPORTANT: Download a copy into user-controlled storage outside this Codespace and Supabase.\n");
    return;
  }
  const content = await readFile(resolve(args["--input"]));
  const passphrase = await hiddenPassphrase("Backup passphrase (not echoed): ");
  const snapshot = decryptSnapshot(content, passphrase);
  if (command === "verify") {
    process.stdout.write("Encrypted backup verified. Dataset revision " + snapshot.revision +
      "; records: " + snapshot.document.relationships.length + " people, " +
      (snapshot.document.captures ?? []).length + " captures, " +
      (snapshot.document.moments ?? []).length + " moments, " +
      (snapshot.document.connectionJourneys ?? []).length + " connection journeys.\n");
    return;
  }
  // A distinct project is required: a new namespace in the *same* project
  // does not count as independent environmental recovery.
  const target = endpoint(process.env.RA_RECOVERY_TARGET_URL, process.env.RA_RECOVERY_TARGET_SECRET_KEY);
  if (target.base === snapshot.sourceProjectUrl) {
    throw new Error("Independent recovery requires a different Supabase project, not a second namespace in the source project.");
  }
  await restoreToEmptyDataset(target, args["--target-owner"], snapshot);
  process.stdout.write("Recovery succeeded and was re-read with matching SHA-256 content. The source dataset was not changed.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write("Recovery error: " + (error instanceof Error ? error.message : "unknown failure") + "\n");
    process.exitCode = 1;
  });
}
