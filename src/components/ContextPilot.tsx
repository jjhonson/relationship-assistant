"use client";

import { useState, type FormEvent } from "react";
import {
  buildPilotBrief,
  getAssistancePlan,
  getEffectivePilotInterpretation,
  getPilotHistory,
  normalizePilotCorrection,
  MAX_PILOT_THREADS,
  pilotContacts,
  type PilotClassification,
  type PilotRelationshipDisposition,
  type PilotRelationshipGoal,
  type PilotRelationshipState,
} from "@/lib/context-pilot";

const classifications: PilotClassification[] = [
  "Friend or family",
  "Recruiter",
  "Coworker",
  "Service provider",
  "Professional contact",
  "Unknown",
];

const states: PilotRelationshipState[] = ["Active", "Occasional", "Dormant", "Recently revived", "Unclear"];

const dispositions: PilotRelationshipDisposition[] = ["Relationship worth managing", "Background only", "Unclear"];
const goals: PilotRelationshipGoal[] = ["This feels right", "I want to stay better connected"];

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
  const [stateCorrection, setStateCorrection] = useState<PilotRelationshipState | "">("");
  const [dispositionCorrection, setDispositionCorrection] = useState<PilotRelationshipDisposition | "">("");
  const [goal, setGoal] = useState<PilotRelationshipGoal | "">("");
  const selected = pilotContacts.find((contact) => contact.id === selectedId);
  const brief = reviewedId === selectedId ? buildPilotBrief(selectedId, consentGranted) : undefined;
  const interpretation = brief
    ? getEffectivePilotInterpretation(brief, {
        classification: classificationCorrection || undefined,
        state: stateCorrection || undefined,
        disposition: dispositionCorrection || undefined,
      })
    : undefined;
  const history = brief ? getPilotHistory(brief) : undefined;
  const plan = brief && interpretation
    ? getAssistancePlan(brief, interpretation.effectiveDisposition, goal || undefined)
    : undefined;

  function selectContact(id: string) {
    setSelectedId(id);
    setConsentGranted(false);
    setReviewedId("");
    setClassificationCorrection("");
    setStateCorrection("");
    setDispositionCorrection("");
    setGoal("");
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
          Every contact, message, classification, tag, history, state, open loop, evidence reference, significance statement, and reason to engage is invented
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

      {brief && interpretation && plan && (
        <section className="space-y-5" aria-labelledby="brief-heading">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 id="brief-heading" className="text-xl font-semibold">Prewritten fictional example brief · {brief.label}</h2>
            <p className="mt-1 text-sm text-stone-600">
              Not AI-generated and not an interpretation of message content. All brief fields below are authored fixture text.
            </p>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold">Relationship type / categories</dt>
                <dd className="mt-1">Suggested classification: {interpretation.suggestedClassification}. {brief.classificationEvidence}<ThreadCitations threadIds={brief.classificationSources} /></dd>
                {brief.categories.some((category) => category !== brief.classification) && (
                  <dd className="mt-1">Additional categories: {brief.categories.filter((category) => category !== brief.classification).join("; ")}</dd>
                )}
                <dd className="mt-1 font-medium text-indigo-900">
                  Effective classification: {interpretation.effectiveClassification}
                  {classificationCorrection ? " (your correction)" : " (suggested; not corrected)"}
                </dd>
                <dd className="mt-1 text-stone-600">Confidence: {brief.confidence}; this is a fictional example, not a verified fact.</dd>
              </div>
              <div>
                <dt className="font-semibold">Shared context / tags</dt>
                <dd className="mt-1">
                  {brief.tags.map((tag) => (
                    <span key={tag.label} className="mr-2 inline-block">{tag.label}<ThreadCitations threadIds={tag.sources} /></span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Relationship history (within the sample)</dt>
                {history ? (
                  <>
                    <dd className="mt-1">Earliest observed meaningful interaction: {history.firstMeaningful}. Latest observed meaningful interaction: {history.mostRecentMeaningful}. Span: {history.span}.</dd>
                    <dd className="mt-1">Pattern: {history.pattern}</dd>
                  </>
                ) : <dd className="mt-1">Unknown</dd>}
              </div>
              <div>
                <dt className="font-semibold">Current state</dt>
                <dd className="mt-1">Suggested state: {interpretation.suggestedState}. {brief.stateEvidence}<ThreadCitations threadIds={brief.stateSources} /></dd>
                <dd className="mt-1 font-medium text-indigo-900">
                  Effective state: {interpretation.effectiveState}
                  {stateCorrection ? " (your correction)" : " (suggested; not corrected)"}
                </dd>
                <dd className="mt-1 text-stone-600">Confidence: {brief.stateConfidence}</dd>
              </div>
              <div>
                <dt className="font-semibold">Relationship disposition</dt>
                <dd className="mt-1">Suggested disposition: {interpretation.suggestedDisposition}. {brief.dispositionEvidence}<ThreadCitations threadIds={brief.dispositionSources} /></dd>
                <dd className="mt-1 font-medium text-indigo-900">
                  Effective disposition: {interpretation.effectiveDisposition}
                  {dispositionCorrection ? " (your correction)" : " (suggested; not corrected)"}
                </dd>
                <dd className="mt-1 text-stone-600">Confidence: {brief.dispositionConfidence}</dd>
              </div>
              <div>
                <dt className="font-semibold">Observed significance</dt>
                <dd className="mt-1">{brief.significance}<ThreadCitations threadIds={brief.significanceSources} /></dd>
              </div>
              <div>
                <dt className="font-semibold">Current maintenance</dt>
                <dd className="mt-1">{brief.maintenance}<ThreadCitations threadIds={brief.maintenanceSources} /></dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">Open loops / commitments</dt>
                {plan.openLoops.length === 0 ? (
                  <dd className="mt-1">None found in the fictional sample.</dd>
                ) : plan.openLoops.map((loop) => (
                  <dd key={loop.commitment} className="mt-1">
                    {loop.commitment}. Owner: {loop.owner}. Status: {loop.status}. Last mentioned: {loop.lastMentioned}.<ThreadCitations threadIds={loop.sources} />
                  </dd>
                ))}
                <dd className="mt-1 text-stone-600">Open commitments are shown for either goal; finishing an obligation is different from nurturing the relationship.</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">Developments observed since the last interaction</dt>
                {brief.developments.length === 0 ? (
                  <dd className="mt-1">None available in this fictional pilot.</dd>
                ) : brief.developments.map((item) => (
                  <dd key={item.development} className="mt-1">{item.development}<ThreadCitations threadIds={item.sources} /></dd>
                ))}
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">Relationship goal and potential reasons to engage</dt>
                {interpretation.effectiveDisposition === "Background only" ? (
                  <dd className="mt-1">Background only: keep this contact searchable, but do not provide relationship-management prompts unless you change the disposition.</dd>
                ) : interpretation.effectiveDisposition === "Unclear" ? (
                  <dd className="mt-1">Relationship goal is deferred until you decide whether this relationship is worth managing.</dd>
                ) : (
                  <>
                    <dd className="mt-1 font-medium text-indigo-900">
                      {goal ? `Your goal: ${goal}` : "Your goal: not chosen yet (no reconnection prompts are shown)"}
                    </dd>
                    {goal === "This feels right" && (
                      <dd className="mt-1">Record kept in the background; no proactive prompts to increase contact.</dd>
                    )}
                    {plan.proactiveNudges && (plan.reasonsToEngage.length === 0 ? (
                      <dd className="mt-1">No grounded reasons to reconnect found in the fictional sample.</dd>
                    ) : plan.reasonsToEngage.map((item) => (
                      <dd key={item.reason} className="mt-1">{item.reason}<ThreadCitations threadIds={item.sources} /></dd>
                    )))}
                  </>
                )}
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
                  onChange={(event) => {
                    const selected = event.target.value as PilotClassification;
                    setClassificationCorrection(normalizePilotCorrection(brief.classification, selected) ?? "");
                  }}
                  className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2"
                >
                  {classifications.map((classification) => <option key={classification}>{classification}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">
                Correct the current state
                <select
                  value={stateCorrection || brief.state}
                  onChange={(event) => {
                    const selected = event.target.value as PilotRelationshipState;
                    setStateCorrection(normalizePilotCorrection(brief.state, selected) ?? "");
                  }}
                  className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2"
                >
                  {states.map((state) => <option key={state}>{state}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium sm:col-span-2">
                Correct the relationship disposition
                <select
                  value={dispositionCorrection || brief.disposition}
                  onChange={(event) => {
                    const selected = event.target.value as PilotRelationshipDisposition;
                    setDispositionCorrection(normalizePilotCorrection(brief.disposition, selected) ?? "");
                    if (selected !== "Relationship worth managing") setGoal("");
                  }}
                  className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2"
                >
                  {dispositions.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              {interpretation.effectiveDisposition === "Relationship worth managing" && (
                <label className="text-sm font-medium sm:col-span-2">
                  Relationship goal (your decision; not inferred)
                  <select
                    value={goal}
                    onChange={(event) => setGoal(event.target.value as PilotRelationshipGoal | "")}
                    className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2"
                  >
                    <option value="">Not chosen</option>
                    {goals.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              )}
            </div>
            {(classificationCorrection || stateCorrection || dispositionCorrection) && (
              <p className="mt-3 text-sm text-indigo-900">
                Your corrections: {[classificationCorrection, stateCorrection, dispositionCorrection].filter(Boolean).join("; ")}
              </p>
            )}
            <p className="mt-3 text-xs text-stone-500">Corrections and the goal are held in page memory and reset when you change contacts or refresh.</p>
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
