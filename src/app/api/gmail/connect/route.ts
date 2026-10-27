import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/gmail/config";
import { buildAuthUrl, newState } from "@/lib/gmail/oauth";
import { FLOW_COOKIE, cookieOptions } from "@/lib/gmail/session";
import { seal } from "@/lib/gmail/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = loadConfig();
  if (!cfg.ok) return NextResponse.redirect(new URL("/gmail?error=not_configured", req.url));
  const { state, verifier } = newState();
  const res = NextResponse.redirect(buildAuthUrl(cfg.config, state, verifier));
  res.cookies.set(FLOW_COOKIE, seal(JSON.stringify({ state, verifier }), cfg.config.sessionSecret), cookieOptions(600));
  return res;
}
