"use client";

import type { PilotAnalysisResult } from "@/app/real-pilot/actions";
import { SaveRelationshipButton } from "@/components/SaveRelationshipButton";

type ReadyAnalysis = Extract<PilotAnalysisResult, { kind: "ready" }>;

export function RealRelationshipBrief({ result }: { result: ReadyAnalysis }) {
  const evidenceById = new Map(result.evidence.map((item) => [item.id, item]));

  const evidence = (ids: string[]) => (
    <span className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const item = evidenceById.get(id);
        return (
          <span
            key={id}
            title={item ? `${item.from} → ${item.to}` : id}
            className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-600"
          >
            {item ? `${item.date} · ${item.subject}` : id}
          </span>
        );
      })}
    </span>
  );

  const inference = result.inference;

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
            First real relationship brief
          </p>
          <h2 className="mt-1 text-2xl font-semibold">{result.personLabel}</h2>
        </div>
        <div className="flex items-center gap-2">
          <SaveRelationshipButton result={result} />
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-800">
            {inference.confidence} confidence
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <BriefValue
          label="Classification"
          value={inference.classification.value}
          evidence={evidence(inference.classification.evidenceIds)}
        />
        <BriefValue
          label="Disposition"
          value={inference.disposition.value}
          evidence={evidence(inference.disposition.evidenceIds)}
        />
        <BriefValue
          label="Current state"
          value={inference.currentState.value}
          evidence={evidence(inference.currentState.evidenceIds)}
        />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <BriefDimensions
          label="Relationship contexts"
          empty="No relationship context confidently inferred."
          items={inference.relationshipContexts.map((item) => ({
            value: item.value,
            evidence: evidence(item.evidenceIds),
          }))}
        />
        <BriefDimensions
          label="Relationship roles"
          empty="No relationship role confidently inferred."
          items={inference.relationshipRoles.map((item) => ({
            value: item.value,
            evidence: evidence(item.evidenceIds),
          }))}
        />
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Tags</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {inference.tags.length > 0 ? inference.tags.map((tag) => (
            <span key={`${tag.label}-${tag.evidenceIds.join("-")}`} className="rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-800">
              {tag.label}
            </span>
          )) : <span className="text-sm text-stone-500">None inferred.</span>}
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-stone-50 p-4">
        <h3 className="font-semibold">Observed history</h3>
        <p className="mt-2 text-sm text-stone-700">{inference.history.pattern}</p>
        <p className="mt-2 text-sm text-stone-600">
          {inference.history.earliestObservedMeaningfulInteraction} to {inference.history.latestObservedMeaningfulInteraction}
        </p>
        <div className="mt-3">{evidence(inference.history.evidenceIds)}</div>
      </div>

      <BriefList
        title="Open loops"
        empty="No open commitments inferred."
        items={inference.openLoops.map((item) => ({
          key: `${item.commitment}-${item.owner}`,
          primary: item.commitment,
          secondary: `${item.owner} · ${item.status}`,
          evidence: evidence(item.evidenceIds),
        }))}
      />

      <BriefList
        title="Reasons to engage"
        empty="No concrete reason to engage inferred from these messages."
        items={inference.reasonsToEngage.map((item) => ({
          key: item.reason,
          primary: item.reason,
          evidence: evidence(item.evidenceIds),
        }))}
      />

      <div className="mt-6">
        <h3 className="font-semibold">Unknowns / limits</h3>
        {inference.unknowns.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
            {inference.unknowns.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-stone-500">None returned.</p>
        )}
      </div>

      <div className="mt-6 border-t border-stone-200 pt-4 text-xs text-stone-500">
        Analyzed {result.messageCount} message{result.messageCount === 1 ? "" : "s"} from the approved conversations
        using {result.model}. Message bodies were processed ephemerally and are not shown or persisted here.
        {result.usage.totalTokens !== null ? ` ${result.usage.totalTokens.toLocaleString()} API tokens used.` : ""}
      </div>
    </section>
  );
}

function BriefValue({
  label,
  value,
  evidence,
}: {
  label: string;
  value: string;
  evidence: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stone-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 font-semibold text-stone-900">{value}</p>
      <div className="mt-3">{evidence}</div>
    </div>
  );
}

function BriefDimensions({
  label,
  empty,
  items,
}: {
  label: string;
  empty: string;
  items: Array<{ value: string; evidence: React.ReactNode }>;
}) {
  return (
    <div className="rounded-xl border border-stone-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item) => (
            <div key={item.value}>
              <p className="font-semibold text-stone-900">{item.value}</p>
              <div className="mt-2">{item.evidence}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BriefList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{
    key: string;
    primary: string;
    secondary?: string;
    evidence: React.ReactNode;
  }>;
}) {
  return (
    <div className="mt-6">
      <h3 className="font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="mt-2 space-y-3">
          {items.map((item) => (
            <div key={item.key} className="rounded-xl border border-stone-200 p-4">
              <p className="text-sm font-medium text-stone-900">{item.primary}</p>
              {item.secondary && <p className="mt-1 text-sm text-stone-600">{item.secondary}</p>}
              <div className="mt-3">{item.evidence}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
