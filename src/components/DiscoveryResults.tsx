"use client";

import { useState } from "react";
import type { SamplingStats } from "@/lib/gmail/messages";
import type { DiscoveryCandidate, DiscoveryDiagnostics } from "@/lib/gmail/discovery";

export function DiscoveryResults({
  candidates,
  diagnostics,
  sampling,
  examined,
  oldest,
  newest,
}: {
  candidates: DiscoveryCandidate[];
  diagnostics: DiscoveryDiagnostics;
  sampling: SamplingStats;
  examined: number;
  oldest: string | null;
  newest: string | null;
}) {
  const [feedback, setFeedback] = useState<Record<string, "relevant" | "not-relevant">>({});
  const range = oldest && newest ? `${oldest} to ${newest}` : "No dated messages found";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Sample examined</h2>
        <dl className="mt-2 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
          <div>Messages examined: {examined} (maximum 200)</div>
          <div>Date range: {range}</div>
          <div>Sent messages examined: {diagnostics.sentExamined}</div>
          <div>Received messages examined: {diagnostics.receivedExamined}</div>
          <div>Distinct months covered: {diagnostics.distinctMonths}</div>
          <div>Time windows queried: {sampling.windowsQueried}; contacts looked up for replies: {sampling.enrichedContacts}</div>
          <div>
            Excluded: {diagnostics.excludedBulk} bulk, {diagnostics.excludedGroup} group, {diagnostics.excludedAutomated} automated,{" "}
            {diagnostics.excludedUnparseable} unparseable, {diagnostics.excludedOneWayHighVolume} high-volume one-way,{" "}
            {diagnostics.excludedSingleInbound} lone inbound
          </div>
          <div>Viable candidates: {diagnostics.candidatesSurviving}; displayed: {candidates.length} (the shortlist is capped at 10)</div>
          <div>Sent budget: {sampling.sentBudget} ({sampling.monthWindowsQueried} monthly windows, {sampling.windowsQueried - sampling.monthWindowsQueried} quarterly top-up windows); reply-lookup budget: {sampling.enrichmentBudget}</div>
          <div className="sm:col-span-2">
            Sent mail is sampled first with one message per calendar month for up to 10 years, then any remaining budget is spent on calendar quarters, and a few incoming messages are looked up for the most frequent sent contacts. This is an on-demand, biased and incomplete sample, not a mailbox sync; a missing contact may reflect sampling limits, other accounts, or filtering.
          </div>
        </dl>
      </section>

      <aside className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-950">
        <p><strong>Observed:</strong> sender/recipient headers, dates, Gmail Sent labels, thread IDs, and mailing-list or automation headers.</p>
        <p className="mt-1"><strong>Not verified:</strong> who a person is, their occupation, your relationship, or whether an exchange was meaningful. No message bodies were read.</p>
      </aside>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Possible contacts</h2>
        {candidates.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-white p-5 text-stone-600">
            No direct-contact candidates met the conservative metadata rules in this sample.
          </p>
        ) : (
          <ul className="space-y-4">
            {candidates.map((candidate) => (
              <li key={candidate.address} className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row">
                  <div>
                    <h3 className="font-semibold">{candidate.name}</h3>
                    <p className="text-sm text-stone-600">{candidate.address}</p>
                  </div>
                  <span className="h-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
                    {candidate.uncertainty}
                  </span>
                </div>
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-stone-700">
                  {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                <p className="mt-2 text-sm text-stone-600">
                  Last observed exchange: {candidate.lastExchange ?? "date unavailable"}
                </p>
                <div role="group" className="mt-4 flex flex-wrap items-center gap-2" aria-label={`Feedback for ${candidate.address}`}>
                  <span className="mr-1 text-sm text-stone-600">Is this useful?</span>
                  <button
                    type="button"
                    aria-pressed={feedback[candidate.address] === "relevant"}
                    onClick={() => setFeedback((current) => ({ ...current, [candidate.address]: "relevant" }))}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${feedback[candidate.address] === "relevant" ? "border-indigo-700 bg-indigo-700 text-white" : "border-stone-300"}`}
                  >
                    Relevant
                  </button>
                  <button
                    type="button"
                    aria-pressed={feedback[candidate.address] === "not-relevant"}
                    onClick={() => setFeedback((current) => ({ ...current, [candidate.address]: "not-relevant" }))}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${feedback[candidate.address] === "not-relevant" ? "border-indigo-700 bg-indigo-700 text-white" : "border-stone-300"}`}
                  >
                    Not relevant
                  </button>
                  {feedback[candidate.address] && <span className="text-xs text-stone-500">Feedback stays in this page only.</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
