import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/gmail/config";
import { AuthError, refresh } from "@/lib/gmail/oauth";
import { CRED_COOKIE, cookieOptions, readCreds, sealCreds } from "@/lib/gmail/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo") === "/discover" ? "/discover" : "/gmail";
  const cfg = loadConfig();
  if (!cfg.ok) return NextResponse.redirect(new URL("/gmail?error=not_configured", req.url));

  const store = await cookies();
  const creds = readCreds(store.get(CRED_COOKIE)?.value, cfg.config.sessionSecret);
  if (!creds) return NextResponse.redirect(new URL(returnTo, req.url));
  if (creds.expiresAt - 60_000 >= Date.now()) return NextResponse.redirect(new URL(returnTo, req.url));

  try {
    const refreshed = await refresh(cfg.config, creds);
    const res = NextResponse.redirect(new URL(returnTo, req.url));
    res.cookies.set(
      CRED_COOKIE,
      sealCreds(refreshed, cfg.config.sessionSecret),
      cookieOptions(60 * 60 * 24 * 30),
    );
    return res;
  } catch (e) {
    const error = e instanceof AuthError ? "session_expired" : "api_error";
    return NextResponse.redirect(new URL(`/gmail?error=${error}`, req.url));
  }
}
