/**
 * Explicit application dataset selection; shared by the server and backup CLI.
 * This protects against configuration mistakes, not a compromised service key.
 */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const marker = "raDatasetPurpose";
const fixtureHosts = new Set(["example.supabase.co", "fictional.supabase.co"]);

export function getDatasetMode(env = process.env) {
  const mode = env.RA_DATASET_MODE || "fictional";
  if (mode !== "fictional" && mode !== "personal") throw new Error("Invalid relationship dataset mode.");
  if (mode === "personal" && (env.RA_STORAGE_BACKEND !== "supabase" || env.RA_PERSONAL_DATA_ENABLED !== "yes")) {
    throw new Error("Personal storage requires explicit private activation and Supabase.");
  }
  return mode;
}

export function resolveDatasetProfile(env = process.env) {
  const mode = getDatasetMode(env);
  const personal = mode === "personal";
  const raw = personal ? env.RA_PERSONAL_SUPABASE_URL : env.RA_SUPABASE_URL;
  const secret = personal ? env.RA_PERSONAL_SUPABASE_SECRET_KEY : env.RA_SUPABASE_SECRET_KEY;
  const ownerId = personal ? env.RA_PERSONAL_DB_OWNER_ID : env.RA_DB_OWNER_ID;
  const fictionalOwner = env.RA_DB_OWNER_ID;
  const personalOwner = env.RA_PERSONAL_DB_OWNER_ID;
  if (!raw || !secret || !ownerId) throw new Error("Private database is not configured.");
  if (!uuid.test(ownerId)) throw new Error("Invalid dataset identifier.");
  if (personal && (!fictionalOwner || !uuid.test(fictionalOwner))) {
    throw new Error("A distinct fictional dataset must remain configured.");
  }
  if (fictionalOwner && personalOwner && fictionalOwner.toLowerCase() === personalOwner.toLowerCase()) {
    throw new Error("Fictional and personal datasets must have distinct identifiers.");
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error("Invalid Supabase project URL."); }
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port)
    throw new Error("Invalid Supabase project URL.");
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(secret))
    throw new Error("A server-only Supabase secret key is required.");
  if ((env.NODE_ENV === "test" || env.VITEST) && !fixtureHosts.has(url.hostname))
    throw new Error("Automated tests cannot access a live relationship database.");
  return { mode, base: url.origin, secret, ownerId };
}

/** Old unmarked snapshots are fictional-only. Unknown markers always fail closed. */
export function assertDatasetPurpose(document, mode) {
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new Error("Invalid relationship dataset document.");
  const purpose = document[marker];
  if (purpose !== mode && !(mode === "fictional" && purpose === undefined)) {
    throw new Error("Relationship dataset belongs to a different or unverified mode.");
  }
}

/** Only create the personal marker on a genuinely new personal dataset. */
export function prepareDatasetForWrite(document, mode, previousRevision) {
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new Error("Invalid relationship dataset document.");
  if (mode === "personal" && previousRevision === -1 && document[marker] === undefined)
    return { ...document, [marker]: "personal" };
  assertDatasetPurpose(document, mode);
  return document;
}
