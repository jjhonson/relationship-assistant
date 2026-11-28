import { NextResponse } from "next/server";
import { CRED_COOKIE, FLOW_COOKIE } from "@/lib/gmail/session";

import { legacyGmailAllowed } from "@/lib/gmail/personal-session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!legacyGmailAllowed()) return new NextResponse("Gmail experiment unavailable.", { status: 403 });
  const res = NextResponse.redirect(new URL("/gmail", req.url), 303);
  res.cookies.delete(CRED_COOKIE);
  res.cookies.delete(FLOW_COOKIE);
  return res;
}
