import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/gmail/config";
import { BROADER_EXPERIMENT_BATCH_WINDOWS, BROADER_EXPERIMENT_WINDOWS } from "@/lib/gmail/experiment";
import {
  fetchBroaderMetadataBatch,
} from "@/lib/gmail/messages";
import { CRED_COOKIE, readCreds } from "@/lib/gmail/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Request rejected" }, { status: 403 });
  }

  const config = loadConfig();
  const credentials = config.ok
    ? readCreds((await cookies()).get(CRED_COOKIE)?.value, config.config.sessionSecret)
    : null;
  if (!config.ok || !credentials || credentials.expiresAt <= Date.now()) {
    return NextResponse.json({ error: "Gmail is not connected or the session expired." }, { status: 401 });
  }

  let body: { startWindow?: unknown; windowCount?: unknown; anchor?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid experiment batch." }, { status: 400 });
  }
  const startWindow = Number(body.startWindow);
  const windowCount = Number(body.windowCount);
  const anchor = body.anchor === undefined ? Date.now() : Number(body.anchor);
  if (
    !Number.isInteger(startWindow) || startWindow < 0 || startWindow >= BROADER_EXPERIMENT_WINDOWS ||
    !Number.isInteger(windowCount) || windowCount < 1 || windowCount > BROADER_EXPERIMENT_BATCH_WINDOWS ||
    startWindow % BROADER_EXPERIMENT_BATCH_WINDOWS !== 0 ||
    startWindow + windowCount > BROADER_EXPERIMENT_WINDOWS ||
    (windowCount !== BROADER_EXPERIMENT_BATCH_WINDOWS && startWindow + windowCount !== BROADER_EXPERIMENT_WINDOWS) ||
    !Number.isFinite(anchor)
  ) {
    return NextResponse.json({ error: "Invalid experiment batch." }, { status: 400 });
  }

  try {
    const result = await fetchBroaderMetadataBatch(
      credentials.accessToken,
      config.config.experimentDetailCap,
      startWindow,
      windowCount,
      anchor,
    );
    return NextResponse.json({ ...result, anchor }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Gmail could not be reached for this batch." }, { status: 502 });
  }
}
