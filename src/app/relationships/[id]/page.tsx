import Link from "next/link";
import { notFound } from "next/navigation";
import { updateRelationshipIntention, updateRelationshipLabels } from "../actions";
import { correctRelationshipName, dismissInferredConnection } from "../capture-actions";
import {
  getRelationship,
  listRelationships,
  listConnectionJourneys,
  listCapturesForRelationship,
  listConnectedPeopleForRelationship,
  listSharedHouseholdContextForRelationship,
} from "@/lib/relationship-store";
import type { RelationshipContextValue, RelationshipRoleValue } from "@/lib/inference-benchmark";
import { relationshipIntentionModes } from "@/lib/relationship-record";
import HomeCapture from "@/app/HomeCapture";
import ConnectionSubjectsReview from "./ConnectionSubjectsReview";
import { userOwnsCommitment } from "@/lib/connection-subjects";
import MemoryCorrectionForm from "./MemoryCorrectionForm";
import ConnectionJournal from "./ConnectionJournal";
import { relationshipContactDetails, relationshipContextLabel, lastContactDescription, relationshipContextSummary, relationshipInteractionHistory } from "@/lib/relationship-overview";
import { homeInteractionDate } from "@/lib/home-view";

export const dynamic = "force-dynamic";

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

export default async function RelationshipDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string; labels?: string; intention?: string; name?: string }>;
}) {
  const { id } = await params;
  const { updated, labels, intention, name } = await searchParams;
  const relationship = await getRelationship(id);
  if (!relationship) notFound();
  const people = await listRelationships();
  const capturedNotes = await listCapturesForRelationship(id);
  const journeys = await listConnectionJourneys(id);
  const connectedPeople = await listConnectedPeopleForRelationship(id);
  const sharedHouseholdContext = await listSharedHouseholdContextForRelationship(id);

  const labelsAction = updateRelationshipLabels.bind(null, relationship.id);
  const intentionAction = updateRelationshipIntention.bind(null, relationship.id);
  const primaryFacts = relationship.durableFacts.slice(0, 4);
  const additionalFacts = relationship.durableFacts.slice(4);
  const primaryThreads = relationship.activeThreads.slice(0, 3);
  const additionalThreads = relationship.activeThreads.slice(3);
  const inferredContexts = relationship.inferredRelationshipContexts ?? [];
  const inferredRoles = relationship.inferredRelationshipRoles ?? [];
  const labelAuthority = relationship.labelAuthority ?? "legacy-unverified";
  const nameAction = correctRelationshipName.bind(null, relationship.id);
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const contactDetails = relationshipContactDetails(relationship, today);
  const contextLabel = relationshipContextLabel(relationship, today);
  const lastContact = lastContactDescription(relationship, today);
  const rememberedContext = relationshipContextSummary(relationship, contactDetails, today);
  const history = relationshipInteractionHistory(relationship, capturedNotes, journeys, today);

  return (
    <div className="mx-auto max-w-4xl space-y-7 pb-12">
      <Link href="/relationships" className="text-sm font-medium text-stone-600 hover:underline">
        ← Saved relationships
      </Link>

      {updated === "1" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Relationship updated. The pasted conversation itself was not saved.
        </div>
      )}
      {labels === "1" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Relationship context updated.
        </div>
      )}
      {intention === "1" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Relationship intention saved. It stays yours to set and change, not the AI&apos;s.
        </div>
      )}
      {name === "1" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Name corrected and saved as user-confirmed.
        </div>
      )}

      <header className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-7">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-950">{relationship.personLabel}</h1>
        {contextLabel && (
          <p className="mt-1 text-sm text-stone-600">
            {contextLabel.value}{contextLabel.inferred ? " · Suggested relationship context" : ""}
          </p>
        )}
        {relationship.personLabelAuthority === "inferred-unverified" && (
          <p className="mt-1 text-xs text-stone-600">Name inferred from a saved memory. You can correct it below.</p>
        )}
        {contactDetails.length > 0 && (
          <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {contactDetails.map((item) => (
              <div key={item.label}>
                <dt className="text-xs font-medium text-stone-500">{item.label}</dt>
                <dd className="mt-1 break-words text-sm text-stone-900">{item.value}</dd>
                {!item.confirmed && <p className="mt-0.5 text-xs text-stone-500">Last recorded {homeInteractionDate(item.observedAt)}</p>}
              </div>
            ))}
          </dl>
        )}
        <div className="mt-5 border-t border-stone-100 pt-4">
          <p className="text-xs font-medium text-stone-500">Last contact</p>
          <p className="mt-1 text-base font-medium text-stone-900">{lastContact.date}{lastContact.elapsed && <span className="ml-2 text-sm font-normal text-stone-500">{lastContact.elapsed}</span>}</p>
        </div>
      </header>

      <details className="rounded-xl border border-stone-200 bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-stone-800">Remember something or add contact details</summary>
        <p className="my-3 text-sm text-stone-600">
          Add a note, conversation or contact details about {relationship.personLabel}.
          {!contactDetails.some((item) => item.label === "LinkedIn") && " You can also paste their LinkedIn profile text or address."}
          {" "}Only the information you supply is used; external profiles are not fetched.
        </p>
        <HomeCapture contextRelationshipId={relationship.id}
          people={people.map((person) => ({ id: person.id, label: person.personLabel }))} />
      </details>

      <section aria-labelledby="context-heading" className="space-y-3">
        <h2 id="context-heading" className="text-lg font-semibold tracking-tight text-stone-900">What&apos;s going on</h2>
        {rememberedContext.length ? (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white px-5">
            {rememberedContext.map((item) => (
              <li key={item.id} className="py-3">
                <p className="text-sm leading-relaxed text-stone-800">{item.value}</p>
                <p className="mt-1 text-xs text-stone-500">Last recorded {homeInteractionDate(item.date)}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-stone-500">No additional context recorded yet.</p>}
      </section>

      <ConnectionSubjectsReview
        key={relationship.updatedAt + ":" + (relationship.actionableMemoryFeedback?.length ?? 0) +
          ":" + (relationship.dismissedConnectionSubjects?.length ?? 0)}
        relationshipId={relationship.id} />

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold tracking-tight text-stone-900">History</h2>
        {history.length ? (
          <>
            <ol className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white px-5">
              {history.slice(0, 5).map((entry) => (
                <li key={entry.id} className="py-3">
                  <p className="text-sm font-medium text-stone-900">{homeInteractionDate(entry.date)}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{entry.label}</p>
                  <p className="mt-1 text-sm text-stone-700">{entry.detail}</p>
                  {entry.captureId && <Link href={"/captures/" + encodeURIComponent(entry.captureId)} className="text-xs text-stone-600 underline underline-offset-2">View saved memory</Link>}
                </li>
              ))}
            </ol>
            {history.length > 5 && (
              <details className="text-sm text-stone-600">
                <summary className="cursor-pointer">Earlier history ({history.length - 5})</summary>
                <ol className="mt-2 space-y-3">
                  {history.slice(5).map((entry) => (
                    <li key={entry.id} className="border-b border-stone-100 pb-3">
                      <p className="font-medium">{homeInteractionDate(entry.date)} · {entry.label}</p>
                      <p className="mt-1">{entry.detail}</p>
                      {entry.captureId && <Link href={"/captures/" + encodeURIComponent(entry.captureId)} className="underline underline-offset-2">View saved memory</Link>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </>
        ) : <p className="text-sm text-stone-500">No dated interaction history recorded yet.</p>}
      </section>

      <details className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-medium text-stone-700">All memories, settings and sources</summary>
        <div className="mt-5 space-y-5">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Relationship settings</h2>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-indigo-700">Correct name</summary>
          <form action={nameAction} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm text-stone-700">
              Name
              <input name="personLabel" required maxLength={120} defaultValue={relationship.personLabel}
                className="mt-1 block rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <button type="submit" className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white">Save correction</button>
          </form>
        </details>
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {labelAuthority === "user-confirmed" ? "Your confirmed relationship labels" :
              labelAuthority === "legacy-unverified" ? "Previously saved labels (review needed)" : "Your confirmed relationship labels"}
          </p>
          {labelAuthority === "legacy-unverified" && (
            <p className="mt-1 text-xs text-amber-700">
              These labels predate provenance tracking. We cannot tell which were selected by you and which came from AI.
              Review and save them below to confirm your choices.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {relationship.relationshipContexts.map((item) => (
            <span key={item} className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-800">
              {item}
            </span>
          ))}
          {relationship.relationshipRoles.map((item) => (
            <span key={item} className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
              {item}
            </span>
          ))}
          {relationship.relationshipContexts.length === 0 && relationship.relationshipRoles.length === 0 && (
            <span className="text-stone-500">No labels confirmed yet.</span>
          )}
          </div>
        </div>
        {(inferredContexts.length > 0 || inferredRoles.length > 0) && (
          <div className="mt-4 border-t border-stone-100 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">AI-suggested (not confirmed)</p>
            <p className="mt-1 text-xs text-stone-600">
              Suggestions from conversation evidence, not changes to your confirmed labels.
              Select any you agree with in the editor below to confirm them.
            </p>
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {[...inferredContexts.map((item) => ({ ...item, kind: "Context" })),
                ...inferredRoles.map((item) => ({ ...item, kind: "Role" }))].map((item) => (
                <li key={item.kind + ":" + item.value} className="rounded-lg border border-dashed border-stone-300 px-3 py-2 text-stone-700">
                  <span className="font-medium">{item.value}</span>
                  <span className="ml-2 text-xs text-stone-500">{item.kind} · Unverified · {item.lastSuggestedAt}</span>
                  <span className="block text-xs text-stone-500">
                    Source: {item.sourceIds.map((id) => relationship.sources.find((source) => source.id === id)?.label ?? "Recorded evidence").join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-4 text-sm text-stone-600">
          Last observed interaction: {relationship.lastInteractionAt ?? "Unknown"} · {relationship.sources.length} source
          {relationship.sources.length === 1 ? "" : "s"} represented
        </p>

        <details className="mt-5 border-t border-stone-200 pt-4">
          <summary className="cursor-pointer text-sm font-medium text-indigo-700">
            Review / confirm relationship labels
          </summary>
          <form action={labelsAction} className="mt-4 space-y-4">
            <p className="text-sm text-stone-600">
              Choose only the contexts and roles you personally confirm. AI suggestions remain separate until you select them.
            </p>
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-stone-500">Contexts</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {contextOptions.map((value) => (
                  <label key={value} className="flex items-center gap-2 rounded-full border border-stone-300 px-3 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="context"
                      value={value}
                      defaultChecked={relationship.relationshipContexts.includes(value)}
                    />
                    {value}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-stone-500">Roles</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {roleOptions.map((value) => (
                  <label key={value} className="flex items-center gap-2 rounded-full border border-stone-300 px-3 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="role"
                      value={value}
                      defaultChecked={relationship.relationshipRoles.includes(value)}
                    />
                    {value}
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="submit"
              className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            >
              Save confirmed labels
            </button>
          </form>
        </details>

        </section>
        <ConnectionJournal relationshipId={relationship.id} journeys={journeys} />
      {(connectedPeople.length > 0 || sharedHouseholdContext.length > 0) && (
        <section className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Connected people and shared context</h2>
          <p className="mt-1 text-sm text-stone-600">
            Connections inferred from memories you saved, not confirmed relationships. Notes from another person
            are not treated as conversations you had with {relationship.personLabel}.
          </p>
          {connectedPeople.length > 0 && (
            <ul className="mt-4 space-y-3">
              {connectedPeople.map(({ related, link, event }) => (
                <li key={link.id} className="rounded-xl border border-stone-200 p-4">
                  <Link href={"/relationships/" + related.id} className="font-medium text-indigo-700 hover:underline">
                    {related.personLabel}
                  </Link>
                  <span className="ml-2 text-xs text-stone-500">{link.kind === "household" ? "Shared household" :
                    link.kind === "colleague" ? "Colleague" : link.kind === "family" ? "Family connection" : "Connection"} · Unverified</span>
                  <p className="mt-1 text-sm text-stone-700">{link.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <Link href={"/captures/" + event.id} className="text-indigo-700 hover:underline">View source memory</Link>
                    <form action={dismissInferredConnection.bind(null, id, event.id, link.id)}>
                      <button type="submit" className="font-medium text-rose-700 hover:underline">Not connected</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {sharedHouseholdContext.length > 0 && (
            <div className="mt-4 border-t border-stone-100 pt-4">
              <h3 className="text-sm font-semibold text-stone-800">Potentially shared household details</h3>
              <ul className="mt-2 space-y-3">
                {sharedHouseholdContext.map(({ event, detail, via }, index) => (
                  <li key={event.id + ":" + index} className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
                    {detail}
                    <p className="mt-1 text-xs text-stone-500">
                      From a saved memory about {via.personLabel}, not an interaction with {relationship.personLabel}.
                      {" "}<Link href={"/captures/" + event.id} className="text-indigo-700 hover:underline">Review source</Link>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-indigo-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Your intention</p>
            <h2 className="mt-1 text-xl font-semibold text-stone-900">What does a good relationship look like?</h2>
            <p className="mt-2 max-w-3xl text-sm text-stone-600">
              Set the kind of connection you want to maintain. This is your goal, not a closeness score or a
              category the system will change based on how often you talk.
            </p>
          </div>
          {relationship.intention?.mode && (
            <span className="rounded-full bg-indigo-100 px-3 py-1.5 text-sm font-semibold text-indigo-800">
              {relationship.intention.mode}
            </span>
          )}
        </div>
        <form action={intentionAction} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-stone-700">
            Relationship mode
            <select
              name="intentionMode"
              defaultValue={relationship.intention?.mode ?? ""}
              className="mt-1 block w-full max-w-md rounded-lg border border-stone-300 bg-white px-3 py-2"
            >
              <option value="">Not set yet</option>
              {relationshipIntentionModes.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <p className="text-xs text-stone-500">
            Stay in Touch (professional distance) · Stay Connected (warm professional tie) ·
            Stay Close (close friends or family). These are different destinations, not steps on a ladder.
          </p>
          <label className="block text-sm font-medium text-stone-700">
            What would you like this relationship to be like over time? <span className="font-normal text-stone-500">(optional)</span>
            <textarea
              name="desiredOutcome"
              rows={3}
              maxLength={600}
              defaultValue={relationship.intention?.desiredOutcome ?? ""}
              placeholder="For example: Be a trusted former colleague who shares useful ideas, remembers what matters, and stays naturally connected."
              className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            Save relationship intention
          </button>
        </form>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Durable context</h2>
          <p className="mt-1 text-sm text-stone-600">
            Stable things worth carrying forward, not a transcript summary.
          </p>
          {relationship.durableFacts.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">No durable facts captured yet.</p>
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {primaryFacts.map((fact) => (
                  <li key={fact.id} className="rounded-xl bg-stone-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                          {fact.category} · {fact.label}
                        </p>
                        <p className="mt-1 text-sm font-medium text-stone-900">{fact.value}</p>
                      </div>
                      <span className="text-xs text-stone-500">{fact.lastObservedAt}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {additionalFacts.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium text-indigo-700">
                    {additionalFacts.length} more things remembered
                  </summary>
                  <ul className="mt-3 space-y-3">
                    {additionalFacts.map((fact) => (
                      <li key={fact.id} className="rounded-xl bg-stone-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                          {fact.category} · {fact.label}
                        </p>
                        <p className="mt-1 text-sm text-stone-800">{fact.value}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Active threads</h2>
          <p className="mt-1 text-sm text-stone-600">
            Topics mentioned previously. They may have changed since the last conversation.
          </p>
          {relationship.activeThreads.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">No active threads captured yet.</p>
          ) : (
            <>
              <ul className="mt-4 space-y-4">
                {primaryThreads.map((thread) => (
                  <li key={thread.id} className="rounded-xl border border-stone-200 p-4">
                    <h3 className="font-semibold text-stone-900">{thread.topic}</h3>
                    <p className="mt-1 text-sm text-stone-700">{thread.state}</p>
                    <p className="mt-3 text-xs font-medium text-indigo-700">
                      Earlier context: {thread.nextChangeSignal}
                    </p>
                  </li>
                ))}
              </ul>
              {additionalThreads.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium text-indigo-700">
                    {additionalThreads.length} more active threads
                  </summary>
                  <ul className="mt-3 space-y-3">
                    {additionalThreads.map((thread) => (
                      <li key={thread.id} className="rounded-xl border border-stone-200 p-3">
                        <p className="font-medium text-stone-900">{thread.topic}</p>
                        <p className="mt-1 text-sm text-stone-600">{thread.state}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </section>

      {relationship.stewardshipOpportunities.length > 0 && (
        <details id="future-signals" className="rounded-xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Earlier possibilities ({relationship.stewardshipOpportunities.length})
          </summary>
          <p className="mt-2 text-xs text-stone-500">
            Things mentioned in earlier conversations, not events you need to monitor or verify.
          </p>
          <ul className="mt-3 space-y-2">
            {relationship.stewardshipOpportunities.map((opportunity) => (
              <li key={opportunity.id} className="rounded-lg bg-stone-50 p-3 text-sm">
                <p className="font-medium text-stone-900">{opportunity.reason}</p>
                <p className="mt-1 text-stone-600">Context mentioned: {opportunity.trigger}</p>
                <p className="mt-1 text-xs text-stone-500">Captured {opportunity.observedAt}
                  {opportunity.userConfirmed ? " · User-confirmed correction" : ""}
                </p>
                <details className="mt-2 text-xs text-stone-600">
                  <summary className="cursor-pointer">Source information</summary>
                  <ul className="mt-1 space-y-1">
                    {opportunity.sourceIds.map((id) => {
                      const source = relationship.sources.find((item) => item.id === id);
                      return <li key={id}>{source ? source.label + " · " + source.observedAt : "Source no longer available"}</li>;
                    })}
                  </ul>
                </details>
                <MemoryCorrectionForm relationshipId={relationship.id}
                  target={{ kind: "opportunity", id: opportunity.id }}
                  text={opportunity.reason} context={opportunity.trigger} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {relationship.openLoops.length > 0 && (
        <section id="recorded-commitments" className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Open commitments</h2>
          <ul className="mt-4 space-y-3">
            {relationship.openLoops.map((loop) => (
              <li key={loop.commitment + loop.owner} className="rounded-xl bg-amber-50 p-4">
                <p className="font-medium text-amber-950">{loop.commitment}</p>
                <p className="mt-1 text-sm text-amber-800">{loop.owner} · {loop.status}
                  {loop.userConfirmed ? " · User-confirmed correction" : ""}
                </p>
                <details className="mt-2 text-xs text-stone-600">
                  <summary className="cursor-pointer">Source information</summary>
                  <ul className="mt-1 space-y-1">
                    {loop.sourceIds.map((id) => {
                      const source = relationship.sources.find((item) => item.id === id);
                      return <li key={id}>{source ? source.label + " · " + source.observedAt : "Source no longer available"}</li>;
                    })}
                  </ul>
                </details>
                <MemoryCorrectionForm relationshipId={relationship.id}
                  target={{ kind: "open-loop", commitment: loop.commitment, owner: loop.owner }}
                  text={loop.commitment} context={loop.owner}
                  canMarkDone={userOwnsCommitment(loop.owner, process.env.RELATIONSHIP_USER_LABEL ?? "Jason")} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(relationship.actionableMemoryFeedback?.length ?? 0) > 0 && (
        <details className="rounded-2xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-stone-800">
            Memory corrections ({relationship.actionableMemoryFeedback?.length})
          </summary>
          <p className="mt-2 text-xs text-stone-600">
            The original source remains recorded here. Retired memories no longer appear in active attention.
          </p>
          <ol className="mt-3 space-y-3">
            {relationship.actionableMemoryFeedback?.map((item, index) => (
              <li key={item.key + ":" + item.decidedAt + ":" + index} className="rounded-lg bg-stone-50 p-3 text-sm">
                <p className="font-medium text-stone-900">{item.originalText}</p>
                <p className="mt-1 text-xs text-stone-600">{item.disposition} · {item.decidedAt.slice(0, 10)}</p>
                {item.replacement && (
                  <p className="mt-1 text-sm text-stone-700">
                    User-confirmed replacement: {item.replacement.text}
                  </p>
                )}
                <p className="mt-1 text-xs text-stone-600">
                  Original source{item.sourceIds.length === 1 ? "" : "s"}:{" "}
                  {item.sourceIds.map((id) => relationship.sources.find((source) => source.id === id)?.label ??
                    "Source no longer available").join(", ")}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}

      {capturedNotes.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Remembered moments</h2>
          <p className="mt-1 text-sm text-stone-600">Notes and photos you saved yourself. Select one to see its source details and everyone linked to it.</p>
          <ol className="mt-4 space-y-3">
            {capturedNotes.map((capture) => (
              <li key={capture.id} className="rounded-xl border border-stone-200 p-4">
                <Link href={"/captures/" + capture.id} className="font-medium text-indigo-700 hover:underline">
                  {capture.capturedAt.slice(0, 10)} · {capture.summary || (capture.source === "user-image" ? "Saved photo" : "Saved note")}
                </Link>
                <p className="mt-1 line-clamp-2 text-sm text-stone-600">
                  {capture.source === "user-image" ? "Photo" : "Note"}
                  {capture.note ? ` · ${capture.source === "user-image" ? "Your context: " : ""}${capture.note}` : " · No written context"}
                </p>
                {capture.status === "pending" && <span className="text-xs text-amber-700">Awaiting interpretation</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <details className="rounded-2xl border border-stone-200 bg-white p-6">
        <summary className="cursor-pointer font-semibold">Sources and limits</summary>
        {(relationship.identities?.length ?? 0) > 0 && (
          <>
            <h3 className="mt-4 font-semibold text-stone-900">Confirmed identities</h3>
            <ul className="mt-2 space-y-2 text-sm text-stone-600">
              {relationship.identities.map((identity) => (
                <li key={identity.id}>
                  {identity.source} · {identity.kind} · {identity.value}
                </li>
              ))}
            </ul>
          </>
        )}
        <h3 className="mt-4 font-semibold text-stone-900">Sources</h3>
        <ul className="mt-2 space-y-2 text-sm text-stone-600">
          {relationship.sources.map((source) => (
            <li key={source.id}>
              {source.observedAt} · {source.label} · {source.source}
            </li>
          ))}
        </ul>
        {relationship.unknowns.length > 0 && (
          <>
            <h3 className="mt-5 font-semibold text-stone-900">Unknowns</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
              {relationship.unknowns.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>
        )}
      </details>
        </div>
      </details>
    </div>
  );
}
