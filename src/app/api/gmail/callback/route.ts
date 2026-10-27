import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { loadConfig } from "@/lib/gmail/config";
import { unseal } from "@/lib/gmail/crypto";
import { exchangeCode } from "@/lib/gmail/oauth";
import { CRED_COOKIE, FLOW_COOKIE, cookieOptions, sealCreds } from "@/lib/gmail/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (error?: string) => {
    const res = NextResponse.redirect(new URL(error ? `/gmail?error=${error}` : "/gmail", req.url));
    res.cookies.delete(FLOW_COOKIE);
    return res;
  };
  const cfg = loadConfig();
  if (!cfg.ok) return back("not_configured");
  if (url.searchParams.get("error")) {
    return back(url.searchParams.get("error") === "access_denied" ? "cancelled" : "auth_failed");
  }
  const code = url.searchParams.get("code");
  const store = await cookies();
  const flowRaw = store.get(FLOW_COOKIE)?.value;
  const flowJson = flowRaw ? unseal(flowRaw, cfg.config.sessionSecret) : null;
  let flow: { state?: string; verifier?: string } = {};
  try {
    flow = flowJson ? JSON.parse(flowJson) : {};
  } catch {}
  if (!code || !flow.state || !flow.verifier || flow.state !== url.searchParams.get("state")) {
    return back("invalid_state");
  }
  try {
    const creds = await exchangeCode(cfg.config, code, flow.verifier);
    const res = back();
    res.cookies.set(CRED_COOKIE, sealCreds(creds, cfg.config.sessionSecret), cookieOptions(60 * 60 * 24 * 30));
    return res;
  } catch {
    return back("auth_failed");
  }
}
