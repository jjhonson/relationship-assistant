import "server-only";
import { assertDatasetPurpose, getDatasetMode, prepareDatasetForWrite, resolveDatasetProfile, type DatasetProfile } from "../../scripts/dataset-profile.mjs";

type Snapshot = { revision: number; document: unknown };
class Conflict extends Error {}
export function isSupabaseStorageEnabled(): boolean {
  const purpose = getDatasetMode();
  if (purpose === "personal" && process.env.NODE_ENV !== "production")
    throw new Error("Personal storage is available only in the reviewed production runtime.");
  const mode = process.env.RA_STORAGE_BACKEND;
  if (!mode || mode === "json") return false;
  if (mode === "supabase") return true;
  throw new Error("Unsupported relationship storage backend.");
}
function settings(): DatasetProfile {
  if (!isSupabaseStorageEnabled()) throw new Error("Private database is not configured.");
  return resolveDatasetProfile();
}
async function rpc(profile: DatasetProfile, name: "ra_store_read" | "ra_store_write", body: object): Promise<unknown> {
  const { base, secret } = profile;
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
async function read(profile: DatasetProfile): Promise<Snapshot | null> {
  const result = await rpc(profile, "ra_store_read", { p_owner_id: profile.ownerId });
  if (result === null) return null;
  if (!result || typeof result !== "object" ||
      !("revision" in result) || !("document" in result) ||
      typeof result.revision !== "number" ||
      !Number.isSafeInteger(result.revision) || result.revision < 0)
    throw new Error("Invalid private database revision.");
  assertDatasetPurpose(result.document, profile.mode);
  return { revision: result.revision, document: result.document };
}
export async function readSupabaseDocument(): Promise<Snapshot | null> {
  return read(settings());
}
async function write(profile: DatasetProfile, document: unknown, previous: number) {
  const prepared = prepareDatasetForWrite(document, profile.mode, previous);
  const result = await rpc(profile, "ra_store_write", {
    p_owner_id: profile.ownerId, p_expected_revision: previous, p_document: prepared,
  });
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result !== previous + 1)
    throw new Error("Invalid committed database revision.");
}
/** Rebase each domain mutation against fresh data on a concurrent write. */
export async function mutateSupabaseDocument<TDoc, TResult>(
  normalize: (source: unknown) => TDoc,
  mutate: (document: TDoc) => TResult | Promise<TResult>,
): Promise<TResult> {
  const profile = settings();
  for (let attempt = 0; attempt < 4; attempt++) {
    const snapshot = await read(profile);
    const document = normalize(snapshot?.document);
    const result = await mutate(document);
    try {
      await write(profile, document, snapshot?.revision ?? -1);
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
