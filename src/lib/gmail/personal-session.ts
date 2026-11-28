import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { getDatasetMode, requirePersonalDatasetProfile } from "../../../scripts/dataset-profile.mjs";
import { loadConfig, type GmailConfig } from "./config";
import { seal, unseal } from "./crypto";
import type { Credentials } from "./oauth";

export const PERSONAL_GMAIL_CALLBACK = "http://localhost:3001/api/gmail/callback";
export const PERSONAL_GMAIL_ORIGIN = "http://localhost:3001";
export const PERSONAL_GMAIL_CRED_COOKIE = "ra_personal_gmail_credentials";
export const PERSONAL_GMAIL_FLOW_COOKIE = "ra_personal_gmail_flow";
export const PERSONAL_GMAIL_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const PERSONAL_GMAIL_FLOW_SECONDS = 10 * 60;
type PersonalConfig = { config: GmailConfig; profileBinding: string; secret: string };
export type PersonalGmailSession = { id: string; createdAt: number; credentials: Credentials };

export function legacyGmailAllowed(env: NodeJS.ProcessEnv = process.env) {
  try { return env.NODE_ENV === "development" && getDatasetMode(env) === "fictional"; }
  catch { return false; }
}

/** Only the explicitly activated personal Codespaces profile and exact
 * loopback callback. Never fall back to fictional credentials or cookies. */
export function personalGmailConfig(env: NodeJS.ProcessEnv = process.env): PersonalConfig | null {
  try {
    if (env.NODE_ENV !== "production" || env.CODESPACES !== "true" ||
        env.RA_PERSONAL_GMAIL_ENABLED !== "yes" ||
        env.RA_PERSONAL_GMAIL_REDIRECT_URI !== PERSONAL_GMAIL_CALLBACK) return null;
    const profile = requirePersonalDatasetProfile(env);
    const loaded = loadConfig({ ...env, GOOGLE_REDIRECT_URI: PERSONAL_GMAIL_CALLBACK });
    if (!loaded.ok) return null;
    const profileBinding = createHmac("sha256", loaded.config.sessionSecret)
      .update(JSON.stringify(["personal-gmail-v1", profile.base, profile.ownerId])).digest("base64url");
    const secret = createHmac("sha256", loaded.config.sessionSecret)
      .update("personal-gmail-cookie:" + profileBinding).digest("base64url");
    return { config: loaded.config, profileBinding, secret };
  } catch { return null; }
}

export function validPersonGmailId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function personGmailPath(id: string) {
  if (!validPersonGmailId(id)) throw new Error("Invalid relationship.");
  return "/relationships/" + encodeURIComponent(id) + "/gmail";
}
export function personalGmailCookieOptions(maxAge: number) {
  // Loopback localhost is a trustworthy origin in supported browsers.
  // Actual cookie/callback behavior still requires browser acceptance.
  return { httpOnly: true, sameSite: "lax" as const, secure: true, path: "/", maxAge };
}
export function createPersonalGmailSession(credentials: Credentials, now = Date.now()): PersonalGmailSession {
  return { id: randomBytes(24).toString("base64url"), createdAt: now, credentials };
}
export function sealPersonalGmailSession(session: PersonalGmailSession, secret: string) {
  return seal(JSON.stringify({ version: 1, kind: "personal-gmail-session", ...session }), secret);
}
export function readPersonalGmailSession(value: string | undefined, secret: string, now = Date.now()): PersonalGmailSession | null {
  if (!value || value.length > 12000) return null;
  try {
    const raw = unseal(value, secret);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || parsed.kind !== "personal-gmail-session" ||
        typeof parsed.id !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(parsed.id) ||
        !Number.isSafeInteger(parsed.createdAt) || parsed.createdAt > now ||
        now - parsed.createdAt >= PERSONAL_GMAIL_SESSION_SECONDS * 1000 ||
        typeof parsed.credentials?.accessToken !== "string" || !parsed.credentials.accessToken ||
        !Number.isFinite(parsed.credentials.expiresAt) ||
        (parsed.credentials.refreshToken !== undefined && typeof parsed.credentials.refreshToken !== "string")) return null;
    return { id: parsed.id, createdAt: parsed.createdAt, credentials: parsed.credentials };
  } catch { return null; }
}
export function sealPersonalGmailFlow(
  flow: { state: string; verifier: string; personId: string }, secret: string, now = Date.now(),
) {
  if (!validPersonGmailId(flow.personId)) throw new Error("Invalid relationship.");
  return seal(JSON.stringify({ version: 1, kind: "personal-gmail-flow", ...flow, issuedAt: now }), secret);
}
export function readPersonalGmailFlow(value: string | undefined, secret: string, now = Date.now()) {
  if (!value || value.length > 4000) return null;
  try {
    const raw = unseal(value, secret);
    if (!raw) return null;
    const flow = JSON.parse(raw);
    if (flow.version !== 1 || flow.kind !== "personal-gmail-flow" ||
        !validPersonGmailId(flow.personId) ||
        typeof flow.state !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(flow.state) ||
        typeof flow.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier) ||
        !Number.isSafeInteger(flow.issuedAt) || flow.issuedAt > now ||
        now - flow.issuedAt >= PERSONAL_GMAIL_FLOW_SECONDS * 1000) return null;
    return { state: flow.state as string, verifier: flow.verifier as string, personId: flow.personId as string };
  } catch { return null; }
}
