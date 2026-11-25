import "server-only";

type Snapshot = { revision: number; document: unknown };
class Conflict extends Error {}
export function isSupabaseStorageEnabled(): boolean {
  const mode = process.env.RA_STORAGE_BACKEND;
  if (!mode || mode === "json") return false;
  if (mode === "supabase") return true;
  throw new Error("Unsupported relationship storage backend.");
}
function settings() {
  const raw = process.env.RA_SUPABASE_URL;
  const secret = process.env.RA_SUPABASE_SECRET_KEY;
  const ownerId = process.env.RA_DB_OWNER_ID;
  if (!raw || !secret || !ownerId) throw new Error("Private database is not configured.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
      url.username || url.password || url.pathname !== "/")
    throw new Error("Invalid Supabase project URL.");
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(secret))
    throw new Error("A server-only Supabase secret key is required.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId))
    throw new Error("Invalid dataset identifier.");
  return { base: url.origin, secret, ownerId };
}
async function rpc(name: "ra_store_read" | "ra_store_write", body: object): Promise<unknown> {
  const { base, secret } = settings();
  let response: Response;
  try {
    response = await fetch(base + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { apikey: secret, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body), cache: "no-store",
    });
  } catch { throw new Error("Private database unavailable. Nothing was saved."); }
  if (!response.ok) {
    let code = "";
    try {
      const data: unknown = await response.json();
      if (data && typeof data === "object" && "code" in data &&
          typeof data.code === "string") code = data.code;
    } catch { /* Do not expose provider errors or credentials. */ }
    if (code === "40001" || code === "23505") throw new Conflict();
    throw new Error("Private database request failed. Nothing was saved.");
  }
  try { return await response.json() as unknown; }
  catch { throw new Error("Invalid private database response."); }
}
export async function readSupabaseDocument(): Promise<Snapshot | null> {
  const { ownerId } = settings();
  const result = await rpc("ra_store_read", { p_owner_id: ownerId });
  if (result === null) return null;
  if (!result || typeof result !== "object" ||
      !("revision" in result) || !("document" in result) ||
      typeof result.revision !== "number" ||
      !Number.isSafeInteger(result.revision) || result.revision < 0)
    throw new Error("Invalid private database revision.");
  return { revision: result.revision, document: result.document };
}
async function write(document: unknown, previous: number) {
  const { ownerId } = settings();
  const result = await rpc("ra_store_write", {
    p_owner_id: ownerId, p_expected_revision: previous, p_document: document,
  });
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result !== previous + 1)
    throw new Error("Invalid committed database revision.");
}
/** Rebase each domain mutation against fresh data on a concurrent write. */
export async function mutateSupabaseDocument<TDoc, TResult>(
  normalize: (source: unknown) => TDoc,
  mutate: (document: TDoc) => TResult | Promise<TResult>,
): Promise<TResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await readSupabaseDocument();
    const document = normalize(snapshot?.document);
    const result = await mutate(document);
    try {
      await write(document, snapshot?.revision ?? -1);
      return result;
    } catch (error) {
      if (error instanceof Conflict && attempt < 3) continue;
      if (error instanceof Conflict)
        throw new Error("Relationship memory changed repeatedly; please retry.");
      throw error;
    }
  }
  throw new Error("Could not save relationship memory.");
}
