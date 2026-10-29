"use client";

import { useActionState } from "react";
import { diagnoseAction, type DiagnoseState } from "@/app/discover/diagnose";

const LABELS = {
  displayed: "Displayed in the shortlist",
  "viable-below-cutoff": "Viable, but below the display cutoff",
  excluded: "Sampled but excluded",
  "not-sampled": "Not present in the sample",
  inconclusive: "Insufficient evidence to classify",
} as const;

export function DiagnosticPanel() {
  const [state, action, pending] = useActionState<DiagnoseState, FormData>(diagnoseAction, null);
  return (
    <section className="rounded-2xl border border-dashed border-stone-400 bg-white p-5">
      <h2 className="text-lg font-semibold">Positive-control check (local development only)</h2>
      <p className="mt-1 text-sm text-stone-600">
        Enter the address of an established correspondent to see how this run treated it. It is sent by POST, compared in memory, and never displayed, logged or stored. This re-runs the bounded discovery sample.
      </p>
      <form action={action} autoComplete="off" className="mt-3 flex flex-wrap items-center gap-3">
        <input name="address" type="email" required autoComplete="off" aria-label="Correspondent email address" className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm" />
        <label className="text-sm text-stone-700">
          <input name="lookup" type="checkbox" className="mr-1" />
          If not in the sample, run a bounded Gmail metadata lookup
        </label>
        <button disabled={pending} className="rounded-lg bg-indigo-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "Checking…" : "Check"}
        </button>
      </form>
      <div role="status" className="mt-3 text-sm text-stone-800">
        {state?.kind === "error" && <p>{state.message}</p>}
        {state?.kind === "report" && (
          <div className="space-y-1">
            <p><strong>{LABELS[state.report.status]}.</strong> {state.report.explanation}</p>
            <p className="text-stone-600">
              Viable candidates: {state.report.viableCount}; displayed: up to {state.report.displayLimit}. Sampled messages mentioning the address: {state.report.messagesMentioning}.
            </p>
            {state.lookup && (
              <p className="text-stone-600">
                Gmail lookup (read-only, headers only, at most {state.lookup.limit} messages): {state.lookup.returned} returned{state.lookup.truncated ? " (more may exist)" : ""};{" "}
                {state.lookup.headersMatching} had the address in From/To/Cc, {state.lookup.directOneToOne} of those looked like direct one-to-one messages.
                {state.lookup.returned === 0 ? " An empty bounded result does not prove nothing exists." : ""} This checks coverage only, not the quality of any relationship.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
