"use client";

import { useState, type FormEvent } from "react";
import {
  buildPilotBrief,
  getEffectivePilotInterpretation,
  MAX_PILOT_THREADS,
  pilotContacts,
  type PilotClassification,
  type PilotRecommendation,
} from "@/lib/context-pilot";

const classifications: PilotClassification[] = [
  "Friend or family",
  "Recruiter",
  "Coworker",
  "Service provider",
  "Professional contact",
  "Unknown",
];

const recommendations: PilotRecommendation[] = [
  "No action needed",
  "Research more",
  "Worthwhile reconnection",
  "User judgment needed",
];

function ThreadCitations({ threadIds }: { threadIds: string[] }) {
  return (
    <span className="ml-1 text-xs">
      Evidence: {threadIds.map((id, index) => (
        <span key={id}>
          {index > 0 && ", "}
          <a className="text-indigo-700 underline" href={`#thread-${id}`}>{id}</a>
        </span>
      ))}
    </span>
  );
}

export function ContextPilot() {
  const [selectedId, setSelectedId] = useState("");
  const [consentGranted, setConsentGranted] = useState(false);
  const [reviewedId, setReviewedId] = useState("");
  const [classificationCorrection, setClassificationCorrection] = useState<PilotClassification | "">("");
  const [recommendationCorrection, setRecommendationCorrection] = useState<PilotRecommendation | "">("");
  const selected = pilotContacts.find((contact) => contact.id === selectedId);
  const brief = reviewedId === selectedId ? buildPilotBrief(selectedId, consentGranted) : undefined;
  const interpretation = brief
    ? getEffectivePilotInterpretation(brief, {
        classification: classificationCorrection || undefined,
        recommendation: recommendationCorrection || undefined,
      })
    : undefined;

  function selectContact(id: string) {
    setSelectedId(id);
    setConsentGranted(false);
    setReviewedId("");
    setClassificationCorrection("");
    setRecommendationCorrection("");
  }

  function reviewThreads(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected && consentGranted) setReviewedId(selected.id);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Context pilot · fictional data</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          Select one example to review prewritten fictional threads and a prewritten example brief. This does not access Gmail
          or interpret message content.
        </p>
      </header>

      <aside className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Stage 1 wireframe only: prewritten examples, no AI relationship understanding</p>
        <p className="mt-1">
          Every contact, message, classification, evidence reference, significance statement, and recommendation is invented
          and prewritten in local fixtures. Nothing is interpreted, fetched, stored, logged, sent to a provider, or used to
          contact anyone. These bundled examples are present in client code before consent; this checkbox only confirms that
          you want to display fiction. It is not a security gate or permission for live Gmail access.
        </p>
      </aside>

      <fieldset className="space-y-3">
        <legend className="mb-3 text-lg font-semibold">Choose one fictional contact</legend>
        {pilotContacts.map((contact) => (
          <label key={contact.id} className="flex cursor-pointer gap-3 rounded-xl border border-stone-200 bg-white p-4">
            <input
              type="radio"
              name="pilot-contact"
              value={contact.id}
              checked={selectedId === contact.id}
              onChange={() => selectContact(contact.id)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">{contact.label} <span className="font-normal text-stone-500">· {contact.scenario}</span></span>
              {selectedId === contact.id && (
                <span className="mt-2 block text-sm text-stone-600">
                  Proposed review: {contact.threads.length} fictional threads, dated {contact.threads[0]?.date} to {contact.threads[contact.threads.length - 1]?.date}.
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {selected && (
        <form onSubmit={reviewThreads} className="space-y-4 rounded-2xl border border-indigo-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Review scope and consent</h2>
          <p className="text-sm text-stone-700">
            If you continue, the page will reveal up to {MAX_PILOT_THREADS} fictional thread examples for {selected.label},
            including dates, fictional sender/recipient labels, subjects, and message text. They stay in page memory only;
            there is no Gmail request, storage, analytics, or external provider processing.
          </p>
          <label className="flex gap-3 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={consentGranted}
              onChange={(event) => {
                setConsentGranted(event.target.checked);
                setReviewedId("");
              }}
              className="mt-1"
            />
            <span>I choose to review these fictional examples for this contact. This is not consent to retrieve real messages or send content to an AI provider.</span>
          </label>
          <button
            type="submit"
            disabled={!consentGranted}
            className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          >
            Review fictional threads
          </button>
        </form>
      )}

      {brief && interpretation && (
        <section className="space-y-5" aria-labelledby="brief-heading">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 id="brief-heading" className="text-xl font-semibold">Prewritten fictional example brief · {brief.label}</h2>
            <p className="mt-1 text-sm text-stone-600">
              Not AI-generated and not an interpretation of message content. All brief fields below are authored fixture text.
            </p>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold">Context and evidence</dt>
                <dd className="mt-1">Suggested classification: {interpretation.suggestedClassification}. {brief.classificationEvidence}<ThreadCitations threadIds={brief.classificationSources} /></dd>
                <dd className="mt-1 font-medium text-indigo-900">
                  Effective interpretation: {interpretation.effectiveClassification}
                  {classificationCorrection ? " (your correction)" : " (suggested; not corrected)"}
                </dd>
                <dd className="mt-1 text-stone-600">Confidence: {brief.confidence}; this is a fictional example, not a verified fact.</dd>
              </div>
              <div>
                <dt className="font-semibold">Observed significance</dt>
                <dd className="mt-1">{brief.significance}<ThreadCitations threadIds={brief.significanceSources} /></dd>
              </div>
              <div>
                <dt className="font-semibold">Current maintenance</dt>
                <dd className="mt-1">{brief.maintenance}<ThreadCitations threadIds={brief.maintenanceSources} /></dd>
              </div>
              <div>
                <dt className="font-semibold">Potential assistance and why</dt>
                <dd className="mt-1">Suggested action: {interpretation.suggestedRecommendation}. {brief.recommendationReason}</dd>
                <dd className="mt-1 font-medium text-indigo-900">
                  Effective action: {interpretation.effectiveRecommendation}
                  {recommendationCorrection ? " (your correction)" : " (suggested; not corrected)"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">Unknowns and verification</dt>
                <dd className="mt-1">{brief.unknowns.join(" ")}</dd>
                <dd className="mt-1">Verify the classification and whether this contact matters to you before acting.</dd>
              </div>
            </dl>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Correct the relationship classification
                <select
                  value={classificationCorrection || brief.classification}
                  onChange={(event) => setClassificationCorrection(event.target.value as PilotClassification)}
                  className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2"
                >
                  {classifications.map((classification) => <option key={classification}>{classification}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                Correct the assistance suggestion
                <select
                  value={recommendationCorrection || brief.recommendation}
                  onChange={(event) => setRecommendationCorrection(event.target.value as PilotRecommendation)}
                  className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2"
                >
                  {recommendations.map((recommendation) => <option key={recommendation}>{recommendation}</option>)}
                </select>
              </label>
            </div>
            {(classificationCorrection || recommendationCorrection) && (
              <p className="mt-3 text-sm text-indigo-900">
                Your corrections: {[classificationCorrection, recommendationCorrection].filter(Boolean).join("; ")}
              </p>
            )}
            <p className="mt-3 text-xs text-stone-500">Corrections are held in page memory and reset when you change contacts or refresh.</p>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Fictional supporting threads</h3>
            {brief.threads.map((thread) => (
              <article id={`thread-${thread.id}`} key={thread.id} className="rounded-xl border border-stone-200 bg-white p-4">
                <p className="text-xs text-stone-500">Local fictional source · {thread.id} · {thread.date}</p>
                <h4 className="mt-1 font-semibold">{thread.subject}</h4>
                <p className="text-sm text-stone-600">{thread.from} → {thread.to}</p>
                <p className="mt-2 text-sm">{thread.body}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
