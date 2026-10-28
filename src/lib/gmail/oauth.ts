import { createHash, randomBytes } from "node:crypto";
import { GMAIL_SCOPE, type GmailConfig } from "./config";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type Credentials = { accessToken: string; refreshToken?: string; expiresAt: number };

export class AuthError extends Error {}

export function newState() {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  return { state, verifier };
}

export function buildAuthUrl(config: GmailConfig, state: string, verifier: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Credentials> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  if (!res.ok) {
    let error: unknown;
    try {
      error = ((await res.json()) as { error?: unknown }).error;
    } catch {}
    if (error === "invalid_grant") throw new AuthError("Refresh token rejected");
    throw new Error(`Token endpoint returned ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("Token response missing access token");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

export function exchangeCode(config: GmailConfig, code: string, verifier: string) {
  return tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
}

export async function refresh(config: GmailConfig, creds: Credentials): Promise<Credentials> {
  if (!creds.refreshToken) throw new AuthError("Session expired");
  const next = await tokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token",
  });
  return { ...next, refreshToken: next.refreshToken ?? creds.refreshToken };
}
