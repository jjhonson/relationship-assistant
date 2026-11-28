import { describe, expect, it } from "vitest";
import {
  createPersonalGmailSession, legacyGmailAllowed, personalGmailConfig, readPersonalGmailFlow,
  readPersonalGmailSession, sealPersonalGmailFlow, sealPersonalGmailSession, PERSONAL_GMAIL_CALLBACK,
  PERSONAL_GMAIL_SESSION_SECONDS, personGmailPath,
} from "./personal-session";
import { createPersonGmailApprovalStore, PERSON_GMAIL_APPROVAL_TTL_MS } from "./person-import-consent";
import { newState } from "./oauth";
import type { PersonImportCandidate, PersonImportScope } from "./person-import";

const env = {
  NODE_ENV: "production", CODESPACES: "true", RA_DATASET_MODE: "personal", RA_STORAGE_BACKEND: "supabase",
  RA_PERSONAL_DATA_ENABLED: "yes", RA_DB_OWNER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  RA_PERSONAL_DB_OWNER_ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  RA_PERSONAL_SUPABASE_URL: "https://fictional.supabase.co", RA_PERSONAL_SUPABASE_SECRET_KEY: "sb_secret_fixture_only",
  RA_PERSONAL_GMAIL_ENABLED: "yes", RA_PERSONAL_GMAIL_REDIRECT_URI: PERSONAL_GMAIL_CALLBACK,
  GOOGLE_CLIENT_ID: "fixture-id", GOOGLE_CLIENT_SECRET: "fixture-secret", SESSION_SECRET: "x".repeat(32),
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/gmail/callback",
} as const;
const binding = { profileBinding: "profile", sessionId: "session", personId: "person", personLabel: "Alex" };
const scope: PersonImportScope = { personId: "person", mailboxAddress: "owner@example.test", confirmedAddresses: ["alex@example.test"] };
const candidate: PersonImportCandidate = { messageId: "message", threadId: "thread", observedAt: "2026-11-20T15:00:00.000Z",
  direction: "received", providerKey: "gmail:owner@example.test:message", contactAddress: "alex@example.test" };

describe("personal-only Gmail credentials", () => {
  it("requires personal activation and the exact loopback callback, never the legacy origin", () => {
    expect(personalGmailConfig(env)?.config.redirectUri).toBe(PERSONAL_GMAIL_CALLBACK);
    for (const modified of [
      { RA_PERSONAL_GMAIL_ENABLED: "" }, { RA_PERSONAL_GMAIL_REDIRECT_URI: env.GOOGLE_REDIRECT_URI },
      { NODE_ENV: "development" }, { CODESPACES: "" }, { RA_PERSONAL_DATA_ENABLED: "" },
      { RA_PERSONAL_DB_OWNER_ID: env.RA_DB_OWNER_ID }, { SESSION_SECRET: "short" },
    ]) expect(personalGmailConfig({ ...env, ...modified })).toBeNull();
    expect(legacyGmailAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(legacyGmailAllowed(env)).toBe(false);
    expect(legacyGmailAllowed({ ...env, NODE_ENV: "development" })).toBe(false);
    expect(() => personGmailPath("//outside")).toThrow();
  });
  it("binds credentials and OAuth state to the exact personal profile and absolute expiry", () => {
    const a = personalGmailConfig(env)!;
    const b = personalGmailConfig({ ...env, RA_PERSONAL_DB_OWNER_ID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })!;
    const now = 10000;
    const session = createPersonalGmailSession({ accessToken: "test-token", expiresAt: now + 3600000 }, now);
    const token = sealPersonalGmailSession(session, a.secret);
    expect(token).not.toContain("test-token");
    expect(readPersonalGmailSession(token, a.secret, now)).toEqual(session);
    expect(readPersonalGmailSession(token, b.secret, now)).toBeNull();
    expect(readPersonalGmailSession(token, env.SESSION_SECRET, now)).toBeNull();
    expect(readPersonalGmailSession(token, a.secret, now + PERSONAL_GMAIL_SESSION_SECONDS * 1000)).toBeNull();
    const flow = { ...newState(), personId: "person" };
    const sealed = sealPersonalGmailFlow(flow, a.secret, now);
    expect(readPersonalGmailFlow(sealed, a.secret, now)).toEqual(flow);
    expect(readPersonalGmailFlow(sealed, b.secret, now)).toBeNull();
    expect(readPersonalGmailFlow(sealed, a.secret, now + 600000)).toBeNull();
  });
});
describe("server-held one-use import review", () => {
  it("binds the original selection and returns no mutable input or replay opportunity", () => {
    const store = createPersonGmailApprovalStore();
    const input = { scope: structuredClone(scope), candidates: [structuredClone(candidate)] };
    const { token } = store.prepare(input, binding, 100);
    input.candidates[0].messageId = "tampered";
    expect(() => store.consume(token, { ...binding, sessionId: "another" }, 101)).toThrow();
    expect(() => store.consume(token, { ...binding, personLabel: "Different" }, 101)).toThrow();
    expect(store.consume(token, binding, 101)).toEqual({ scope, candidates: [candidate] });
    expect(() => store.consume(token, binding, 101)).toThrow();
  });
  it("expires, cancels, supersedes and refuses malformed selections", () => {
    const store = createPersonGmailApprovalStore();
    expect(() => store.prepare({ scope, candidates: [] }, binding, 100)).toThrow();
    expect(() => store.prepare({ scope, candidates: [candidate] }, { ...binding, personId: "other" }, 100)).toThrow();
    const first = store.prepare({ scope, candidates: [candidate] }, binding, 100);
    const second = store.prepare({ scope, candidates: [candidate] }, binding, 101);
    expect(() => store.consume(first.token, binding, 102)).toThrow();
    store.cancel(second.token, binding);
    expect(() => store.consume(second.token, binding, 103)).toThrow();
    const disconnected = store.prepare({ scope, candidates: [candidate] }, binding, 104);
    store.cancelSession(binding.profileBinding, binding.sessionId);
    expect(() => store.consume(disconnected.token, binding, 105)).toThrow();
    const expired = store.prepare({ scope, candidates: [candidate] }, binding, 200);
    expect(() => store.consume(expired.token, binding, 200 + PERSON_GMAIL_APPROVAL_TTL_MS)).toThrow();
  });
});
