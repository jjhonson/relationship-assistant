import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DiscoveryResults } from "@/components/DiscoveryResults";
import { loadConfig } from "@/lib/gmail/config";
import { rankCandidates } from "@/lib/gmail/discovery";
import { fetchHistoricalMessages } from "@/lib/gmail/messages";
import { AuthError } from "@/lib/gmail/oauth";
import { CRED_COOKIE, credentialPageAction, readCreds } from "@/lib/gmail/session";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const cfg = loadConfig();
  const store = await cookies();
  const creds = cfg.ok ? readCreds(store.get(CRED_COOKIE)?.value, cfg.config.sessionSecret) : null;
  const action = credentialPageAction(creds);

  if (action === "refresh") redirect("/api/gmail/refresh?returnTo=%2Fdiscover");

  if (!cfg.ok || !creds) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Discover relationships</h1>
        <p className="mt-2 text-stone-600">Review a small, historical sample of Gmail metadata for possible direct contacts.</p>
        <p role="status" className="mt-5 rounded-xl bg-amber-100 p-4 text-amber-950">
          {cfg.ok ? "Connect Gmail to run this on-demand experiment." : "Gmail is not configured. See the README for setup details."}
        </p>
        {cfg.ok && (
          <a href="/api/gmail/connect" className="mt-4 inline-block rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white">
            Connect Gmail
          </a>
        )}
      </div>
    );
  }

  let result:
    | { kind: "ready"; messages: Awaited<ReturnType<typeof fetchHistoricalMessages>> }
    | { kind: "error"; message: string; href: string; action: string };
  try {
    const messages = await fetchHistoricalMessages(creds.accessToken, cfg.config.discoverySampleSize);
    result = { kind: "ready", messages };
  } catch (error) {
    result = {
      kind: "error",
      message: error instanceof AuthError
        ? "Your Gmail session expired or was revoked. Reconnect to continue."
        : "Gmail could not be reached right now. Please try again later.",
      href: error instanceof AuthError ? "/api/gmail/connect" : "/discover",
      action: error instanceof AuthError ? "Reconnect Gmail" : "Retry",
    };
  }

  if (result.kind === "error") {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Discover relationships</h1>
        <p role="alert" className="mt-5 rounded-xl bg-amber-100 p-4 text-amber-950">{result.message}</p>
        <a href={result.href} className="mt-4 inline-block rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white">
          {result.action}
        </a>
      </div>
    );
  }

  const dates = result.messages
    .map((message) => message.internalDate ? new Date(Number(message.internalDate)) : null)
    .filter((date): date is Date => date !== null && !Number.isNaN(date.getTime()))
    .map((date) => date.toISOString().slice(0, 10))
    .sort();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Discover relationships</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          A bounded, metadata-only experiment to surface possible professional contacts. Nothing here confirms a relationship.
        </p>
      </header>
      <DiscoveryResults
        candidates={rankCandidates(result.messages)}
        examined={result.messages.length}
        oldest={dates[0] ?? null}
        newest={dates[dates.length - 1] ?? null}
      />
      <form action="/api/gmail/disconnect" method="post">
        <button className="rounded-lg border border-stone-300 px-4 py-2">Disconnect Gmail</button>
      </form>
    </div>
  );
}
