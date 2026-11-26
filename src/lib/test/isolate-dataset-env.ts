// Tests never inherit the developer's private storage configuration.
for (const key of [
  "RA_STORAGE_BACKEND", "RA_DATASET_MODE", "RA_DB_OWNER_ID",
  "RA_SUPABASE_URL", "RA_SUPABASE_SECRET_KEY", "RA_PERSONAL_DATA_ENABLED",
  "RA_PERSONAL_DB_OWNER_ID", "RA_PERSONAL_SUPABASE_URL", "RA_PERSONAL_SUPABASE_SECRET_KEY",
  "RA_RECOVERY_TARGET_URL", "RA_RECOVERY_TARGET_SECRET_KEY",
]) delete process.env[key];

// Adapter tests explicitly install a mock fetch; without one no Supabase network call is allowed.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/^https?:\/\/[^/]+\.supabase\.co(?::\d+)?(?:\/|$)/i.test(url))
    return Promise.reject(new Error("Unmocked Supabase requests are forbidden in tests."));
  return originalFetch(input, init);
};
