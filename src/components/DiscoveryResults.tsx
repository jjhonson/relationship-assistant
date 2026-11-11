"use client";

import Link from "next/link";
import { useState } from "react";
import { saveDiscoveredRelationship } from "@/app/relationships/actions";
import type {
  RelationshipContextValue,
  RelationshipRoleValue,
} from "@/lib/inference-benchmark";
import type { DiscoveryCandidate, DiscoveryDiagnostics } from "@/lib/gmail/discovery";
import type { SamplingStats } from "@/lib/gmail/messages";

const contextOptions: RelationshipContextValue[] = [
  "Personal relationship",
  "Family",
  "Current coworker",
  "Former colleague",
  "Recruiter",
  "Service provider",
  "Professional contact",
];

const roleOptions: RelationshipRoleValue[] = [
  "Friend",
  "Mentor",
  "Mentee",
  "Advisor",
  "Sponsor",
  "Peer",
  "Collaborator",
];

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
  const range = oldest && newest ? `${oldest} to ${newest}` : "No dated messages found";

  return (
    <div className="space-y-6">
      <aside className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-950">
        <p>
          <strong>What this knows:</strong> Gmail sender/recipient metadata, dates, threads, and whether repeated
          correspondence was observed.
        </p>
        <p className="mt-1">
          <strong>What it does not know yet:</strong> why the relationship matters, what you talked about, or whether
          the person belongs in your life now. No message bodies are read during this step.
        </p>
      </aside>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">People you may want to carry forward</h2>
            <p className="mt-1 text-sm text-stone-600">
              Keep the people worth remembering. Skip the rest. You can add more context later.
            </p>
          </div>
          <Link href="/relationships" className="text-sm font-medium text-indigo-700 hover:underline">
            View relationship memory
          </Link>
        </div>

        {candidates.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-white p-5 text-stone-600">
            No direct-contact candidates met the conservative metadata rules in this sample.
          </p>
        ) : (
          <ul className="space-y-4">
            {candidates.map((candidate) => (
              <CandidateCard key={candidate.address} candidate={candidate} />
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
        <summary className="cursor-pointer font-semibold text-stone-900">How this shortlist was produced</summary>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <div>Messages examined: {examined} (maximum 200)</div>
          <div>Date range: {range}</div>
          <div>Sent messages examined: {diagnostics.sentExamined}</div>
          <div>Received messages examined: {diagnostics.receivedExamined}</div>
          <div>Distinct months covered: {diagnostics.distinctMonths}</div>
          <div>
            Time windows queried: {sampling.windowsQueried}; contacts checked for incoming mail: {sampling.enrichedContacts}
          </div>
          <div>
            Excluded: {diagnostics.excludedBulk} bulk, {diagnostics.excludedGroup} group, {diagnostics.excludedAutomated} automated,{" "}
            {diagnostics.excludedUnparseable} unparseable, {diagnostics.excludedOneWayHighVolume} high-volume one-way,{" "}
            {diagnostics.excludedSingleInbound} lone inbound
          </div>
          <div>
            Viable candidates: {diagnostics.candidatesSurviving}; displayed: {candidates.length}
          </div>
          <div>Sent budget: {sampling.sentBudget}</div>
          <div>Reply-lookup budget: {sampling.enrichmentBudget}</div>
        </dl>
        <p className="mt-4 text-stone-600">
          This is a bounded, biased sample rather than a mailbox sync. Missing someone does not mean the relationship
          is absent from Gmail, and Gmail itself may contain only part of the relationship.
        </p>
      </details>
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: DiscoveryCandidate }) {
  const [choice, setChoice] = useState<"undecided" | "keep" | "skip">("undecided");
  const [contexts, setContexts] = useState<RelationshipContextValue[]>([]);
  const [roles, setRoles] = useState<RelationshipRoleValue[]>([]);
  const [saveState, setSaveState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; id: string; existing: boolean }
    | { kind: "error" }
  >({ kind: "idle" });

  function toggleContext(value: RelationshipContextValue) {
    setContexts((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function toggleRole(value: RelationshipRoleValue) {
    setRoles((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  async function save() {
    setSaveState({ kind: "saving" });
    try {
      const result = await saveDiscoveredRelationship(candidate, contexts, roles);
      setSaveState({ kind: "saved", id: result.id, existing: result.existing });
    } catch {
      setSaveState({ kind: "error" });
    }
  }

  if (choice === "skip") {
    return (
      <li className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-stone-700">{candidate.name}</p>
            <p className="text-sm text-stone-500">Skipped for now.</p>
          </div>
          <button
            type="button"
            onClick={() => setChoice("undecided")}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm"
          >
            Undo
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row">
        <div>
          <h3 className="font-semibold">{candidate.name}</h3>
          <p className="text-sm text-stone-600">{candidate.address}</p>
        </div>
        <span className="h-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
          {candidate.uncertainty}
        </span>
      </div>

      <div className="mt-4 rounded-xl bg-stone-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Why this appeared</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
          {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
        <p className="mt-2 text-sm text-stone-600">
          Last observed exchange: {candidate.lastExchange ?? "date unavailable"}
        </p>
      </div>

      {choice === "undecided" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setChoice("keep")}
            className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            Keep this person
          </button>
          <button
            type="button"
            onClick={() => setChoice("skip")}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm"
          >
            Skip
          </button>
        </div>
      )}

      {choice === "keep" && (
        <div className="mt-5 border-t border-stone-200 pt-5">
          <p className="font-medium text-stone-900">Anything obvious about the relationship?</p>
          <p className="mt-1 text-sm text-stone-600">
            Optional. Choose every label that clearly fits. The relationship can be both personal and professional.
          </p>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Contexts</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {contextOptions.map((value) => (
                <TogglePill
                  key={value}
                  label={value}
                  pressed={contexts.includes(value)}
                  onClick={() => toggleContext(value)}
                />
              ))}
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Roles</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {roleOptions.map((value) => (
                <TogglePill
                  key={value}
                  label={value}
                  pressed={roles.includes(value)}
                  onClick={() => toggleRole(value)}
                />
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {saveState.kind === "saved" ? (
              <>
                <Link
                  href={"/relationships/" + saveState.id}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
                >
                  Open relationship
                </Link>
                <span className="text-sm text-stone-600">
                  {saveState.existing ? "Already in relationship memory." : "Saved to relationship memory."}
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={save}
                  disabled={saveState.kind === "saving"}
                  className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  {saveState.kind === "saving" ? "Saving…" : "Save relationship"}
                </button>
                <button
                  type="button"
                  onClick={() => setChoice("undecided")}
                  disabled={saveState.kind === "saving"}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                {saveState.kind === "error" && (
                  <span className="text-sm text-red-700">Could not save this relationship. Try again.</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function TogglePill({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm ${
        pressed
          ? "border-indigo-700 bg-indigo-700 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400"
      }`}
    >
      {label}
    </button>
  );
}
