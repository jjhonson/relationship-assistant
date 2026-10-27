import { seal, unseal } from "./crypto";
import type { Credentials } from "./oauth";

export const CRED_COOKIE = "gmail_creds";
export const FLOW_COOKIE = "gmail_oauth_flow";

export const cookieOptions = (maxAge?: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  ...(maxAge ? { maxAge } : {}),
});

export const sealCreds = (c: Credentials, secret: string) => seal(JSON.stringify(c), secret);

export function readCreds(value: string | undefined, secret: string): Credentials | null {
  if (!value) return null;
  const raw = unseal(value, secret);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Credentials;
    return typeof c.accessToken === "string" && typeof c.expiresAt === "number" ? c : null;
  } catch {
    return null;
  }
}
