"use client";

import { useEffect, useRef, useState } from "react";
import {
  analyzeDiscovery,
  countDistinctObservedAddresses,
  diagnoseAddress,
  type ProbeReport,
} from "@/lib/gmail/discovery";
import {
  BROADER_EXPERIMENT_BATCH_WINDOWS,
  BROADER_EXPERIMENT_LIST_PAGES,
  BROADER_EXPERIMENT_WINDOWS,
  isBroaderExperimentComplete,
  type BroaderExperimentStats,
} from "@/lib/gmail/experiment";
import type { DiscoveryMessage, SamplingStats } from "@/lib/gmail/messages";

const EMPTY_STATS: BroaderExperimentStats = {
  windowsQueried: 0,
  listBucketsQueried: 0,
  plannedDetails: 0,
  recordsFetched: 0,
  duplicateIds: 0,
  failedListBuckets: 0,
  failedDetails: 0,
  apiRequests: 0,
  listRequests: 0,
  detailRequests: 0,
};

type RunState = {
  status: "running" | "complete" | "partial";
  batchesFinished: number;
  failedBatches: number;
  stats: BroaderExperimentStats;
};

function datesAndYears(messages: DiscoveryMessage[]) {
  const dates = messages.flatMap((message) => {
    const date = message.internalDate ? new Date(Number(message.internalDate)) : null;
    return date && !Number.isNaN(date.getTime()) ? [date.toISOString().slice(0, 10)] : [];
  });
  return {
    dates: new Set(dates).size,
    years: new Set(dates.map((date) => date.slice(0, 4))).size,
  };
}

function addStats(left: BroaderExperimentStats, right: BroaderExperimentStats): BroaderExperimentStats {
  return Object.fromEntries(
    Object.keys(left).map((key) => [
      key,
      left[key as keyof BroaderExperimentStats] + right[key as keyof BroaderExperimentStats],
    ]),
  ) as BroaderExperimentStats;
}

function reportLabel(report: ProbeReport) {
  const rank = report.rank === null ? "" : `, heuristic rank ${report.rank} of ${report.viableCount}`;
  return `${report.status}${rank}; ${report.messagesMentioning} scanned metadata record(s) mentioned the address`;
}

export function BroaderMetadataExperiment({
  baselineMessages,
  baselineSampling,
  ownerAddresses,
  detailCap,
}: {
  baselineMessages: DiscoveryMessage[];
  baselineSampling: SamplingStats;
  ownerAddresses: string[];
  detailCap: number;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<DiscoveryMessage[]>([]);
  const [run, setRun] = useState<RunState | null>(null);
  const [aliases, setAliases] = useState("");
  const [controlAddress, setControlAddress] = useState("");
  const [control, setControl] = useState<{ baseline: ProbeReport; broader: ProbeReport } | null>(null);
  const stopRequested = useRef(false);
  const runningRef = useRef(false);
  const aliasAddresses = aliases.split(/[,\s]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const knownOwnerAddresses = [...ownerAddresses, ...aliasAddresses];
  const baseline = analyzeDiscovery(baselineMessages, 10, { ownerAddresses: knownOwnerAddresses });
  const broader = analyzeDiscovery(messages, 10, { ownerAddresses: knownOwnerAddresses });
  const dateTotals = datesAndYears(messages);
  const yearDistribution = (items: DiscoveryMessage[]) => {
    const distribution = new Map<string, number>();
    for (const message of items) {
      const date = message.internalDate ? new Date(Number(message.internalDate)) : null;
      if (!date || Number.isNaN(date.getTime())) continue;
      const year = String(date.getUTCFullYear());
      distribution.set(year, (distribution.get(year) ?? 0) + 1);
    }
    return distribution;
  };
  const baselineYears = yearDistribution(baselineMessages);
  const broaderYears = yearDistribution(messages);
  const listSlots = Math.min(detailCap, BROADER_EXPERIMENT_WINDOWS * 2);
  const normalRequests = listSlots + detailCap;
  const normalQuota = listSlots * 5 + detailCap * 20;
  const maximumAttempts = listSlots * BROADER_EXPERIMENT_LIST_PAGES * 3 + detailCap * 3;
  const maximumQuota = listSlots * BROADER_EXPERIMENT_LIST_PAGES * 3 * 5 + detailCap * 3 * 20;
  const baselineDateTotals = datesAndYears(baselineMessages);
  const baselineRequests =
    1 + baselineSampling.windowsQueried + baselineSampling.enrichedContacts +
    baselineSampling.sentFetched + baselineSampling.enrichmentFetched;

  useEffect(() => () => {
    stopRequested.current = true;
  }, []);

  async function start() {
    if (!confirmed || runningRef.current) return;
    stopRequested.current = false;
    runningRef.current = true;
    setRunning(true);
    setMessages([]);
    setControl(null);
    setRun({ status: "running", batchesFinished: 0, failedBatches: 0, stats: EMPTY_STATS });
    const gathered: DiscoveryMessage[] = [];
    const seen = new Set<string>();
    let totals = EMPTY_STATS;
    let completed = 0;
    let failed = 0;
    let anchor: number | undefined;

    for (let startWindow = 0; startWindow < BROADER_EXPERIMENT_WINDOWS; startWindow += BROADER_EXPERIMENT_BATCH_WINDOWS) {
      if (stopRequested.current) break;
      let stopAfterBatch = false;
      try {
        const response = await fetch("/api/gmail/experiment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startWindow,
            windowCount: BROADER_EXPERIMENT_BATCH_WINDOWS,
            ...(anchor === undefined ? {} : { anchor }),
          }),
          cache: "no-store",
        });
        if (response.status === 401) {
          failed++;
          stopAfterBatch = true;
          throw new Error("Session expired");
        }
        if (!response.ok) throw new Error("Batch unavailable");
        const result = await response.json() as {
          anchor: number;
          messages: DiscoveryMessage[];
          stats: BroaderExperimentStats;
        };
        anchor = result.anchor;
        let clientDuplicates = 0;
        for (const message of result.messages) {
          if (seen.has(message.id)) {
            clientDuplicates++;
            continue;
          }
          seen.add(message.id);
          gathered.push(message);
        }
        totals = addStats(totals, result.stats);
        totals.recordsFetched = gathered.length;
        totals.duplicateIds += clientDuplicates;
        if (result.stats.failedListBuckets || result.stats.failedDetails) failed++;
        if (result.stats.listBucketsQueried > 0 &&
          result.stats.failedListBuckets === result.stats.listBucketsQueried) stopAfterBatch = true;
      } catch {
        if (!stopAfterBatch) failed++;
      }
      completed++;
      setMessages([...gathered]);
      setRun({ status: "running", batchesFinished: completed, failedBatches: failed, stats: totals });
      if (stopAfterBatch) break;
    }

    setRun({
      status: isBroaderExperimentComplete(completed, failed) ? "complete" : "partial",
      batchesFinished: completed,
      failedBatches: failed,
      stats: totals,
    });
    setRunning(false);
    runningRef.current = false;
    setConfirmed(false);
  }

  function stop() {
    stopRequested.current = true;
  }

  function checkControl(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = controlAddress.trim().toLowerCase();
    setControl({
      baseline: diagnoseAddress(baselineMessages, address, 10, { ownerAddresses: knownOwnerAddresses }),
      broader: diagnoseAddress(messages, address, 10, { ownerAddresses: knownOwnerAddresses }),
    });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-indigo-300 bg-indigo-50/60 p-5">
      <div>
        <h2 className="text-xl font-semibold">Broader metadata experiment (local development only)</h2>
        <p className="mt-1 text-sm text-stone-700">
          Off by default. When you confirm, this manually scans monthly Sent and inbound metadata windows across up to ten years.
          It reads headers, labels, dates, and thread IDs only—never bodies or attachments—and keeps results in this page&apos;s memory.
        </p>
      </div>
      <div className="rounded-xl bg-white p-4 text-sm text-stone-700">
        <p>
          At the configured {detailCap.toLocaleString()} detail cap, the plan makes up to {listSlots} monthly list requests
          and {detailCap.toLocaleString()} metadata detail requests: about {normalRequests.toLocaleString()} Gmail API requests
          ({normalQuota.toLocaleString()} quota units assuming 5 units per list and 20 per metadata get). Two list pages and
          up to three attempts per request give a conservative ceiling of {maximumAttempts.toLocaleString()} API attempts
          ({maximumQuota.toLocaleString()} quota units). A full run may take minutes; rate limits, retries, or interruption can leave it partial.
          This is not a full-mailbox scan.
        </p>
        <p className="mt-2">
          Additional account-owner aliases, only if you have verified them (comma or space separated):
          <input
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
            aria-label="Verified account-owner aliases"
            autoComplete="off"
            className="ml-2 w-full rounded-lg border border-stone-300 px-2 py-1 sm:w-96"
          />
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={running}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1"
        />
        <span>
          I explicitly confirm this local experiment may make up to {detailCap.toLocaleString()} Gmail metadata detail
          requests across the selected historical windows. I understand this can use quota and does not measure relationship strength.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!confirmed || running}
          onClick={start}
          className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Start broader scan
        </button>
        {running && (
          <button type="button" onClick={stop} className="rounded-lg border border-stone-400 px-4 py-2 text-sm">
            Stop after current batch
          </button>
        )}
      </div>

      {run && (
        <div role="status" aria-live="polite" className="space-y-3 rounded-xl bg-white p-4 text-sm text-stone-700">
          <p>
            {run.status === "running" ? "Scanning" : run.status === "complete" ? "Scan complete for the requested windows" : "Partial scan"}:
            {" "}{run.batchesFinished} of {BROADER_EXPERIMENT_WINDOWS / BROADER_EXPERIMENT_BATCH_WINDOWS} batches finished;
            {" "}{run.stats.listBucketsQueried} of {listSlots} budgeted direction/month list buckets attempted;
            {" "}{run.stats.recordsFetched} unique metadata records returned; {run.stats.failedListBuckets} list buckets and
            {" "}{run.stats.failedDetails} detail requests failed; {run.stats.apiRequests} Gmail API attempts.
          </p>
          {run.status !== "complete" && (
            <p className="text-amber-800">
              Coverage is incomplete: {run.failedBatches ? `${run.failedBatches} batch(es) had failures. ` : ""}
              {run.batchesFinished < BROADER_EXPERIMENT_WINDOWS / BROADER_EXPERIMENT_BATCH_WINDOWS
                ? "The scan was stopped or interrupted before all windows were attempted. "
                : ""}
              Missing metadata is not evidence that no correspondence exists.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="py-2 pr-3">Observed in sample</th>
                  <th className="py-2 pr-3">Existing 200-message sample</th>
                  <th className="py-2">Broader experiment</th>
                </tr>
              </thead>
              <tbody>
                <tr><th className="py-1 pr-3 font-medium">Records fetched</th><td>{baselineMessages.length}</td><td>{messages.length}</td></tr>
                <tr><th className="py-1 pr-3 font-medium">Distinct dates / years</th><td>{baselineDateTotals.dates} / {baselineDateTotals.years}</td><td>{dateTotals.dates} / {dateTotals.years}</td></tr>
                <tr><th className="py-1 pr-3 font-medium">Distinct observed addresses</th><td>{countDistinctObservedAddresses(baselineMessages)}</td><td>{countDistinctObservedAddresses(messages)}</td></tr>
                <tr><th className="py-1 pr-3 font-medium">Sent / received records</th><td>{baseline.diagnostics.sentExamined} / {baseline.diagnostics.receivedExamined}</td><td>{broader.diagnostics.sentExamined} / {broader.diagnostics.receivedExamined}</td></tr>
                <tr><th className="py-1 pr-3 font-medium">Direct-contact candidates surviving filters</th><td>{baseline.diagnostics.candidatesSurviving}</td><td>{broader.diagnostics.candidatesSurviving}</td></tr>
                <tr><th className="py-1 pr-3 font-medium">Approximate / actual Gmail API requests</th><td>~{baselineRequests}</td><td>{run.stats.apiRequests} attempted so far</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Broader scan detail requests: {run.stats.detailRequests}; list requests: {run.stats.listRequests};
            {" "}duplicate IDs discarded: {run.stats.duplicateIds}; planned detail budget for attempted windows: {run.stats.plannedDetails}.
          </p>
          <p>
            Sent/received direction comes from Gmail labels and search queries. Candidate counts use direct one-to-one and
            service/bulk filters; this cannot resolve one person with multiple addresses. Similar names are never grouped.
          </p>
          {(baselineYears.size > 0 || broaderYears.size > 0) && (
            <p>
              Records by year (as observed): existing {[...baselineYears].sort(([a], [b]) => a.localeCompare(b)).map(([year, count]) => `${year}: ${count}`).join("; ") || "none"};
              {" "}broader {[...broaderYears].sort(([a], [b]) => a.localeCompare(b)).map(([year, count]) => `${year}: ${count}`).join("; ") || "none"}.
            </p>
          )}
          {broader.candidates.length > 0 && (
            <div>
              <h3 className="font-semibold">Heuristic shortlist on observed correspondence—not relationship strength</h3>
              <ul className="mt-2 space-y-2">
                {broader.candidates.map((candidate) => (
                  <li key={candidate.address} className="rounded-lg border border-stone-200 p-3">
                    <strong>{candidate.name}</strong> ({candidate.address}) — {candidate.sent} sent / {candidate.received} received,
                    {" "}{candidate.threads} distinct threads, {candidate.dates} dates across {candidate.years} years;
                    {" "}last observed {candidate.lastExchange ?? "date unavailable"}.
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.length > 0 && (
            <form onSubmit={checkControl} className="flex flex-wrap items-end gap-2 border-t border-stone-200 pt-3">
              <label className="text-sm">
                Private positive-control comparison
                <input
                  type="email"
                  required
                  value={controlAddress}
                  onChange={(event) => setControlAddress(event.target.value)}
                  autoComplete="off"
                  className="mt-1 block rounded-lg border border-stone-300 px-3 py-1.5"
                />
              </label>
              <button type="submit" className="rounded-lg border border-stone-400 px-3 py-1.5 text-sm">
                Compare both samples
              </button>
              {control && (
                <p className="basis-full" role="status">
                  Existing sample: {reportLabel(control.baseline)}. Broader sample: {reportLabel(control.broader)}.
                  {" "}The address is compared in page memory and is not included in this report.
                </p>
              )}
            </form>
          )}
          <p className="text-xs text-stone-500">
            Counts describe only metadata returned in the attempted scan. More records may improve observed coverage, but headers
            cannot establish complete volume, identity, reciprocity, longevity, depth, quality, or meaningfulness.
          </p>
        </div>
      )}
    </section>
  );
}
