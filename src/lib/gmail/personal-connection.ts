import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeCode, buildAuthUrl, newState, refresh } from "./oauth";
import {
  personalGmailConfig, personalGmailCookieOptions, personGmailPath, validPersonGmailId,
  createPersonalGmailSession, sealPersonalGmailSession, readPersonalGmailSession,
  sealPersonalGmailFlow, readPersonalGmailFlow, PERSONAL_GMAIL_ORIGIN,
  PERSONAL_GMAIL_CRED_COOKIE, PERSONAL_GMAIL_FLOW_COOKIE, PERSONAL_GMAIL_FLOW_SECONDS,
  PERSONAL_GMAIL_SESSION_SECONDS,
} from "./personal-session";
import { getRelationship } from "../relationship-store";
import { personGmailApprovals } from "./person-import-consent";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, PERSONAL_GMAIL_ORIGIN), 303);
}
function blocked() {
  return new NextResponse("Personal Gmail is unavailable.", { status: 403 });
}

export async function startPersonalGmailConnection(req: Request) {
  const configured = personalGmailConfig();
  if (!configured || req.headers.get("origin") !== PERSONAL_GMAIL_ORIGIN) return blocked();
  const data = await req.formData();
  const id = data.get("personId");
  if (!validPersonGmailId(id) || data.get("connect") !== "yes" || !await getRelationship(id)) return blocked();
  const flow = newState();
  const response = NextResponse.redirect(buildAuthUrl(configured.config, flow.state, flow.verifier), 303);
  response.cookies.set(PERSONAL_GMAIL_FLOW_COOKIE, sealPersonalGmailFlow({ ...flow, personId: id }, configured.secret),
    personalGmailCookieOptions(PERSONAL_GMAIL_FLOW_SECONDS));
  return response;
}

export async function finishPersonalGmailConnection(req: Request) {
  const configured = personalGmailConfig();
  if (!configured) return blocked();
  const store = await cookies();
  const flow = readPersonalGmailFlow(store.get(PERSONAL_GMAIL_FLOW_COOKIE)?.value, configured.secret);
  const url = new URL(req.url);
  const back = (error?: string) => {
    const response = redirectTo((flow ? personGmailPath(flow.personId) : "/relationships") +
      (error ? "?error=" + error : ""));
    response.cookies.set(PERSONAL_GMAIL_FLOW_COOKIE, "", personalGmailCookieOptions(0));
    return response;
  };
  if (!flow || flow.state !== url.searchParams.get("state") || !await getRelationship(flow.personId)) return back("invalid_state");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back("invalid_state");
  try {
    const credentials = await exchangeCode(configured.config, code, flow.verifier);
    const oldSession = readPersonalGmailSession(store.get(PERSONAL_GMAIL_CRED_COOKIE)?.value, configured.secret);
    if (oldSession) personGmailApprovals.cancelSession(configured.profileBinding, oldSession.id);
    const response = back();
    response.cookies.set(PERSONAL_GMAIL_CRED_COOKIE,
      sealPersonalGmailSession(createPersonalGmailSession(credentials), configured.secret),
      personalGmailCookieOptions(PERSONAL_GMAIL_SESSION_SECONDS));
    return response;
  } catch { return back("auth_failed"); }
}

export async function disconnectPersonalGmail(req: Request) {
  const configured = personalGmailConfig();
  if (!configured || req.headers.get("origin") !== PERSONAL_GMAIL_ORIGIN) return blocked();
  const data = await req.formData();
  const id = data.get("personId");
  if (!validPersonGmailId(id)) return blocked();
  const store = await cookies();
  const session = readPersonalGmailSession(store.get(PERSONAL_GMAIL_CRED_COOKIE)?.value, configured.secret);
  if (session) personGmailApprovals.cancelSession(configured.profileBinding, session.id);
  const response = redirectTo(personGmailPath(id));
  for (const name of [PERSONAL_GMAIL_CRED_COOKIE, PERSONAL_GMAIL_FLOW_COOKIE]) {
    response.cookies.set(name, "", personalGmailCookieOptions(0));
  }
  return response;
}

/** Local cookie inspection only: no provider traffic on page load. */
export async function personalGmailSessionContext() {
  const configured = personalGmailConfig();
  if (!configured) return null;
  const store = await cookies();
  const session = readPersonalGmailSession(store.get(PERSONAL_GMAIL_CRED_COOKIE)?.value, configured.secret);
  return session ? { ...configured, session } : null;
}

type SessionContext = NonNullable<Awaited<ReturnType<typeof personalGmailSessionContext>>>;
/** Only explicit authorized actions refresh. Keep original ID and absolute expiry. */
export async function freshPersonalGmailAccess(context: SessionContext) {
  if (context.session.credentials.expiresAt > Date.now() + 60_000) return context.session.credentials.accessToken;
  const credentials = await refresh(context.config, context.session.credentials);
  const seconds = Math.floor((context.session.createdAt + PERSONAL_GMAIL_SESSION_SECONDS * 1000 - Date.now()) / 1000);
  if (seconds <= 0) throw new Error("Gmail connection expired. Reconnect first.");
  const store = await cookies();
  store.set(PERSONAL_GMAIL_CRED_COOKIE, sealPersonalGmailSession({ ...context.session, credentials }, context.secret),
    personalGmailCookieOptions(seconds));
  return credentials.accessToken;
}
