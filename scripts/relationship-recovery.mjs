#!/usr/bin/env node
/**
 * Explicit, server-side export / inspect / restore for a private dataset.
 * Does not use browser keys or Supabase CLI and never changes application mode.
 * Backups are not independent until the encrypted file leaves the Codespace.
 */
import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { decryptSnapshot, documentDigest, encryptSnapshot, isUuid } from "./recovery-crypto.mjs";
import { assertDatasetPurpose, resolveDatasetProfile } from "./dataset-profile.mjs";

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


/**
 * Recover an authenticated snapshot in a brand-new, isolated local Docker
 * PostgreSQL server. Never consults application credentials or a live database.
 * The database uses tmpfs, no network or published ports, and no Docker logs.
 * Private JSON is supplied only via stdin; no content is printed on failure.
 */
export async function restoreIntoDisposablePostgres(snapshot) {
  if (!isUuid(snapshot.sourceOwnerId) ||
      documentDigest(snapshot.document) !== snapshot.documentSha256) {
    throw new Error("Recovery snapshot failed integrity verification.");
  }
  const ownerId = randomUUID();
  const name = "ra-recovery-" + randomUUID();
  // Explicit local Unix socket: never honor a remote Docker context/host.
  const env = { ...process.env };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  function docker(args, input, timeout = 60_000) {
    return spawnSync("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
      env, input, encoding: "utf8", timeout, maxBuffer: 48 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  function checked(result, label) {
    if (result.error || result.status !== 0) {
      throw new Error(label + " failed; no recovery success was confirmed.");
    }
    return result.stdout.trim();
  }
  if (docker(["info", "--format", "{{.ServerVersion}}"]).status !== 0) {
    throw new Error("A local Docker engine is unavailable. No database was created.");
  }
  const psql = (statement) => docker([
    "exec", "-i", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", "postgres",
  ], statement);
  const sql = (statement) => checked(psql(statement), "Disposable database operation");
  const read = () => JSON.parse(sql(
    "set role service_role; select coalesce(public.ra_store_read('" +
    ownerId + "'::uuid)::text, 'null');"
  ));
  const writeStatement = "set role service_role; select public.ra_store_write('" +
    ownerId + "'::uuid,-1,convert_from(decode('" +
    Buffer.from(JSON.stringify(snapshot.document), "utf8").toString("base64") +
    "','base64'),'UTF8')::jsonb);";
  let started = false;
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    checked(docker([
      "run", "--detach", "--rm", "--name", name,
      "--network", "none", "--log-driver", "none",
      "--tmpfs", "/var/lib/postgresql/data:rw,size=512m",
      "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
      "postgres:17", "-c", "log_statement=none", "-c", "log_min_error_statement=panic",
    ], undefined, 180_000), "Starting fresh PostgreSQL");
    started = true;
    let ready = false;
    for (let i = 0; i < 90 && !interrupted; i++) {
      if (docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
        undefined, 5_000).status === 0) {
        ready = true;
        break;
      }
      await delay(1000);
    }
    if (interrupted) throw new Error("Recovery cancelled.");
    if (!ready) throw new Error("Fresh PostgreSQL did not become ready.");
    sql("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const migration of [
      "20261124235124_relationship_agent_private_json_v1_bridge.sql",
      "20261125154752_relationship_agent_atomic_server_gateway.sql",
    ]) {
      sql(await readFile(new URL("../supabase/migrations/" + migration, import.meta.url), "utf8"));
    }
    const access = sql(
      "select has_function_privilege('anon','public.ra_store_read(uuid)','EXECUTE')," +
      "has_function_privilege('authenticated','public.ra_store_write(uuid,bigint,jsonb)','EXECUTE')," +
      "has_table_privilege('anon','ra_private.relationships','SELECT')," +
      "has_table_privilege('service_role','ra_private.relationships','SELECT');"
    );
    if (access !== "f|f|f|t" || read() !== null) {
      throw new Error("Fresh database access or empty-destination check failed.");
    }
    if (sql(writeStatement) !== "0") throw new Error("Recovery write was not confirmed.");
    const recovered = read();
    if (!recovered || recovered.revision !== 0 ||
        documentDigest(recovered.document) !== snapshot.documentSha256) {
      throw new Error("Restored document did not match the encrypted backup.");
    }
    // Require an occupied destination to reject a second create, and prove
    // that rejection did not modify any of the original recovered content.
    const duplicate = psql(writeStatement);
    if (duplicate.error || duplicate.status === 0 ||
        !/already exists|duplicate|changed/i.test(duplicate.stderr ?? "") ||
        documentDigest(read().document) !== snapshot.documentSha256) {
      throw new Error("Occupied-destination protection failed.");
    }
    if (interrupted) throw new Error("Recovery cancelled.");
    return { verified: true, sourceRevision: snapshot.revision, documentSha256: snapshot.documentSha256 };
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    const removed = docker(["rm", "-f", "-v", name]);
    if (started && (removed.error || (removed.status !== 0 &&
        !/no such container/i.test(removed.stderr ?? "")))) {
      throw new Error("Disposable database cleanup failed; inspect container " + name + ".");
    }
  }
}

function argsFor(command, list) {
  const allowed = command === "backup" ? ["--output"] :
    ["verify", "drill"].includes(command) ? ["--input"] :
    command === "restore" ? ["--input", "--target-owner"] : [];
  if (!allowed.length || list.length !== allowed.length * 2) {
    throw new Error("Usage: backup --output FILE | verify --input FILE | drill --input FILE | restore --input FILE --target-owner UUID");
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
    const profile = resolveDatasetProfile();
    const source = endpoint(profile.base, profile.secret);
    const snapshot = await readRemoteSnapshot(source, profile.ownerId);
    assertDatasetPurpose(snapshot.document, profile.mode);
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
  if (command === "drill") {
    process.stdout.write("Backup authenticated. Starting isolated PostgreSQL recovery.\n");
    await restoreIntoDisposablePostgres(snapshot);
    process.stdout.write("Independent recovery PASSED. Restored document matches SHA-256, private access and occupied-destination checks passed, disposable database removed. Source revision " +
      snapshot.revision + "; records: " + snapshot.document.relationships.length + " people, " +
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
