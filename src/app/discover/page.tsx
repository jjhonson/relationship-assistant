import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DiagnosticPanel } from "@/components/DiagnosticPanel";
import { DiscoveryResults } from "@/components/DiscoveryResults";
import { SpecificPersonLookup } from "@/components/SpecificPersonLookup";
import { loadConfig } from "@/lib/gmail/config";
import { listDiscoveryExclusions } from "@/lib/discovery-preferences";
import { analyzeDiscovery } from "@/lib/gmail/discovery";
import {
  ApiError,
  fetchDiscoverySampleCached,
  fetchOwnerAddress,
} from "@/lib/gmail/messages";
import { AuthError } from "@/lib/gmail/oauth";
import { CRED_COOKIE, credentialPageAction, readCreds } from "@/lib/gmail/session";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ fresh?: string }>;
}) {
  const { fresh } = await searchParams;
  const forceFresh = fresh === "1";
  const cfg = loadConfig();
  const store = await cookies();
  const creds = cfg.ok ? readCreds(store.get(CRED_COOKIE)?.value, cfg.config.sessionSecret) : null;
  const action = credentialPageAction(creds);

  if (action === "refresh") redirect("/api/gmail/refresh?returnTo=%2Fdiscover");

  if (!cfg.ok || !creds) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Find people worth carrying forward</h1>
        <p className="mt-2 text-stone-600">
          Use a small, metadata-only Gmail sample to find plausible relationships, then choose who belongs in Relationship Memory.
        </p>
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
    | { kind: "ready"; sample: Awaited<ReturnType<typeof fetchDiscoverySampleCached>> }
    | { kind: "error"; message: string; href: string; action: string };
  let ownerAddresses: string[] = [];
  try {
    const owner = await fetchOwnerAddress(creds.accessToken);
    ownerAddresses = owner ? [owner] : [];
    const sample = await fetchDiscoverySampleCached(
      creds.accessToken,
      cfg.config.discoverySampleSize,
      new Date(),
      ownerAddresses,
      { force: forceFresh },
    );
    result = { kind: "ready", sample };
    if (forceFresh) redirect("/discover");
  } catch (error) {
    result = {
      kind: "error",
      message: error instanceof AuthError
        ? "Your Gmail session expired or was revoked. Reconnect to continue."
        : error instanceof ApiError && error.rateLimited
          ? "Gmail temporarily rate-limited this discovery scan. Once a scan succeeds, ordinary page refreshes will reuse it for 10 minutes instead of rescanning Gmail."
          : "Gmail could not complete the discovery scan.",
      href: error instanceof AuthError ? "/api/gmail/connect" : "/discover",
      action: error instanceof AuthError ? "Reconnect Gmail" : "Retry",
    };
  }

  if (result.kind === "error") {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Find people worth carrying forward</h1>
        <p role="alert" className="mt-5 rounded-xl bg-amber-100 p-4 text-amber-950">{result.message}</p>
        <a href={result.href} className="mt-4 inline-block rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white">
          {result.action}
        </a>
      </div>
    );
  }

  const exclusions = process.env.NODE_ENV === "development"
    ? await listDiscoveryExclusions()
    : [];
  const excludedAddresses = exclusions
    .filter((item) => item.source === "gmail" && item.kind === "email")
    .map((item) => item.value);
  const { candidates, diagnostics } = analyzeDiscovery(
    result.sample.messages,
    10,
    { ownerAddresses, excludedAddresses },
  );
  const dates = result.sample.messages
    .map((message) => message.internalDate ? new Date(Number(message.internalDate)) : null)
    .filter((date): date is Date => date !== null && !Number.isNaN(date.getTime()))
    .map((date) => date.toISOString().slice(0, 10))
    .sort();

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Find people worth carrying forward</h1>
            <p className="mt-2 max-w-3xl text-stone-600">
              Start with a bounded Gmail metadata sample, then confirm the people you actually want to remember. Message bodies are not read here.
            </p>
            <p className="mt-2 text-xs text-stone-500">
              {result.sample.cache === "live" && "Fresh Gmail metadata scan."}
              {result.sample.cache === "hit" && "Reusing the current Gmail metadata scan to avoid unnecessary API traffic."}
              {result.sample.cache === "stale" && "Showing the last successful Gmail metadata scan because the refresh could not complete."}
            </p>
          </div>
          <a
            href="/discover?fresh=1"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:border-stone-400"
          >
            Scan Gmail again
          </a>
        </div>
      </header>
      <SpecificPersonLookup />
      <DiscoveryResults
        candidates={candidates}
        hiddenCount={diagnostics.excludedUserConfirmed}
        diagnostics={diagnostics}
        sampling={result.sample.stats}
        examined={result.sample.messages.length}
        oldest={dates[0] ?? null}
        newest={dates[dates.length - 1] ?? null}
      />
      {process.env.NODE_ENV === "development" && <DiagnosticPanel />}
      <form action="/api/gmail/disconnect" method="post">
        <button className="rounded-lg border border-stone-300 px-4 py-2">Disconnect Gmail</button>
      </form>
    </div>
  );
}
