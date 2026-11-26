import { describe, expect, it } from "vitest";
import { requirePrivateAlphaRuntime } from "./private-alpha-runtime";
const personal = {
  NODE_ENV: "production", CODESPACES: "true", RA_DATASET_MODE: "personal",
  RA_STORAGE_BACKEND: "supabase", RA_PERSONAL_DATA_ENABLED: "yes",
  RA_DB_OWNER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  RA_PERSONAL_DB_OWNER_ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  RA_PERSONAL_SUPABASE_URL: "https://fictional.supabase.co",
  RA_PERSONAL_SUPABASE_SECRET_KEY: "sb_secret_fixture_only",
};
describe("manual capture runtime gate", () => {
  it("allows fictional development and explicitly enabled Codespaces personal production only", () => {
    expect(() => requirePrivateAlphaRuntime({ NODE_ENV: "development" })).not.toThrow();
    expect(() => requirePrivateAlphaRuntime(personal)).not.toThrow();
    expect(() => requirePrivateAlphaRuntime({ NODE_ENV: "production" })).toThrow();
    expect(() => requirePrivateAlphaRuntime({ ...personal, CODESPACES: "" })).toThrow();
    expect(() => requirePrivateAlphaRuntime({ ...personal, RA_PERSONAL_DATA_ENABLED: "" })).toThrow();
    expect(() => requirePrivateAlphaRuntime({ ...personal, NODE_ENV: "development" })).toThrow();
    expect(() => requirePrivateAlphaRuntime({ ...personal, RA_PERSONAL_DB_OWNER_ID: personal.RA_DB_OWNER_ID })).toThrow();
  });
});
