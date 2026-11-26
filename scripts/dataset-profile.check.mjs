import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDatasetPurpose, getDatasetMode, prepareDatasetForWrite, resolveDatasetProfile, requirePersonalDatasetProfile } from "./dataset-profile.mjs";
const fictional = { RA_STORAGE_BACKEND: "supabase", RA_SUPABASE_URL: "https://fictional.supabase.co",
  RA_SUPABASE_SECRET_KEY: "sb_secret_fictional_fixture", RA_DB_OWNER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const personal = { ...fictional, RA_DATASET_MODE: "personal", RA_PERSONAL_DATA_ENABLED: "yes",
  RA_PERSONAL_SUPABASE_URL: "https://example.supabase.co", RA_PERSONAL_SUPABASE_SECRET_KEY: "sb_secret_personal_fixture",
  RA_PERSONAL_DB_OWNER_ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
test("profile selects the intended independent owner, never falls back to fictional settings", () => {
  assert.equal(getDatasetMode({}), "fictional");
  assert.equal(resolveDatasetProfile(fictional).ownerId, fictional.RA_DB_OWNER_ID);
  const p = resolveDatasetProfile(personal);
  assert.equal(p.ownerId, personal.RA_PERSONAL_DB_OWNER_ID);
  assert.equal(p.secret, personal.RA_PERSONAL_SUPABASE_SECRET_KEY);
  assert.throws(() => resolveDatasetProfile({...personal, RA_PERSONAL_SUPABASE_SECRET_KEY: ""}), /not configured/);
  assert.throws(() => resolveDatasetProfile({...personal, RA_PERSONAL_DATA_ENABLED: ""}), /explicit private activation/);
  assert.throws(() => resolveDatasetProfile({...personal, RA_STORAGE_BACKEND: "json"}), /explicit private activation/);
  assert.throws(() => resolveDatasetProfile({...personal, RA_PERSONAL_DB_OWNER_ID: fictional.RA_DB_OWNER_ID}), /distinct/);
  assert.throws(() => resolveDatasetProfile({...fictional, NODE_ENV: "test", RA_SUPABASE_URL: "https://live-project.supabase.co"}), /Automated tests/);
});
test("only a new personal dataset can be initialized with the personal marker", () => {
  const legacy = {version: 1, relationships: []};
  const marked = prepareDatasetForWrite(legacy, "personal", -1);
  assert.equal(marked.raDatasetPurpose, "personal");
  assert.equal(legacy.raDatasetPurpose, undefined);
  assert.doesNotThrow(() => assertDatasetPurpose(legacy, "fictional"));
  assert.throws(() => assertDatasetPurpose(legacy, "personal"), /different or unverified/);
  assert.throws(() => assertDatasetPurpose(marked, "fictional"), /different or unverified/);
  assert.throws(() => prepareDatasetForWrite(legacy, "personal", 2), /different or unverified/);
  assert.throws(() => assertDatasetPurpose({...legacy, raDatasetPurpose: "other"}, "fictional"), /different or unverified/);
});

test("explicit personal commands cannot fall back to fictional or incomplete configuration", () => {
  assert.throws(() => requirePersonalDatasetProfile(fictional), /explicit personal/);
  assert.throws(() => requirePersonalDatasetProfile({...personal, RA_PERSONAL_DB_OWNER_ID: ""}), /not configured/);
  assert.equal(requirePersonalDatasetProfile(personal).ownerId, personal.RA_PERSONAL_DB_OWNER_ID);
});
