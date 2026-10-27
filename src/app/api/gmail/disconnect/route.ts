import { NextResponse } from "next/server";
import { CRED_COOKIE, FLOW_COOKIE } from "@/lib/gmail/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/gmail", req.url), 303);
  res.cookies.delete(CRED_COOKIE);
  res.cookies.delete(FLOW_COOKIE);
  return res;
}
