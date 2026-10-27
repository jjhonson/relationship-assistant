import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/gmail/config";
import { fetchSample, type GmailSummary } from "@/lib/gmail/messages";
import { AuthError } from "@/lib/gmail/oauth";
import { CRED_COOKIE, readCreds } from "@/lib/gmail/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  not_configured: "Gmail is not configured. See the README for required environment variables.",
  cancelled: "Authorization was cancelled. No access was granted.",
  auth_failed: "Google authorization failed. Please try again.",
  invalid_state: "The authorization attempt expired or was invalid. Please try again.",
};

type View =
  | { kind: "disconnected"; error?: string }
  | { kind: "connected"; summary: GmailSummary; limit: number };

async function load(error?: string): Promise<View> {
  const cfg = loadConfig();
  if (!cfg.ok) return { kind: "disconnected", error: "not_configured" };
  const store = await cookies();
  const creds = readCreds(store.get(CRED_COOKIE)?.value, cfg.config.sessionSecret);
  if (!creds) return { kind: "disconnected", error };
  if (creds.expiresAt - 60_000 < Date.now()) redirect("/api/gmail/refresh");
  try {
    const summary = await fetchSample(creds.accessToken, cfg.config.sampleSize);
    return { kind: "connected", summary, limit: cfg.config.sampleSize };
  } catch (e) {
    return { kind: "disconnected", error: e instanceof AuthError ? "session_expired" : "api_error" };
  }
}

export default async function GmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const view = await load(error);
  const messages: Record<string, string> = {
    ...ERRORS,
    session_expired: "Your Gmail session expired or was revoked. Please reconnect.",
    api_error: "Gmail could not be reached right now. Please try again later.",
  };
  const message = view.kind === "disconnected" && view.error ? messages[view.error] ?? messages.auth_failed : null;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">Gmail connection (proof of concept)</h1>
      <p className="mt-2 text-stone-600">
        Read-only access (<code>gmail.readonly</code>). Message contents are never stored or sent anywhere.
      </p>
      {message && (
        <p role="alert" className="mt-4 rounded-lg bg-amber-100 p-3 text-amber-900">{message}</p>
      )}
      {view.kind === "disconnected" ? (
        <a href="/api/gmail/connect" className="mt-6 inline-block rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white">
          Connect Gmail
        </a>
      ) : (
        <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
          <p className="font-semibold text-green-700">Connected</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div>Messages sampled: {view.summary.sampled} (max {view.limit})</div>
            <div>Unread: {view.summary.unread}</div>
            <div>Date range: {view.summary.oldest ?? "n/a"} to {view.summary.newest ?? "n/a"}</div>
            <div>
              Top sender domains:{" "}
              {view.summary.topSenderDomains.map((d) => `${d.domain} (${d.count})`).join(", ") || "none"}
            </div>
          </dl>
        </section>
      )}
      <form action="/api/gmail/disconnect" method="post" className="mt-4">
        <button className="rounded-lg border border-stone-300 px-4 py-2">Disconnect</button>
      </form>
    </div>
  );
}
