import Link from "next/link";
import { notFound } from "next/navigation";
import { updateRelationshipIntention, updateRelationshipLabels } from "../actions";
import { correctRelationshipName, dismissInferredConnection } from "../capture-actions";
import {
  getRelationship,
  listConnectionJourneys,
  listCapturesForRelationship,
  listConnectedPeopleForRelationship,
  listSharedHouseholdContextForRelationship,
} from "@/lib/relationship-store";
import type { RelationshipContextValue, RelationshipRoleValue } from "@/lib/inference-benchmark";
import { relationshipIntentionModes } from "@/lib/relationship-record";
import PersonConversationalCapture from "./PersonConversationalCapture";
import QuickCaptureForm from "@/components/QuickCaptureForm";
import ConnectionSubjectsReview from "./ConnectionSubjectsReview";
import ConnectionJournal from "./ConnectionJournal";

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
  const latestFact = (label: string) => relationship.durableFacts
    .filter((item) => item.label.toLowerCase() === label.toLowerCase())
    .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt))[0];
  const contactDetails = [
    { label: "Email", value: relationship.identities.find((item) => item.kind === "email")?.value ?? "", fromNote: relationship.identities.some((item) => item.source === "capture") },
    { label: "Phone", value: latestFact("Phone")?.value ?? "", fromNote: !!latestFact("Phone") },
    { label: "Company", value: latestFact("Company")?.value ?? "", fromNote: !!latestFact("Company") },
    { label: "Role", value: latestFact("Role")?.value ?? "", fromNote: !!latestFact("Role") },
    { label: "City", value: latestFact("City")?.value ?? "", fromNote: !!latestFact("City") },
    { label: "LinkedIn", value: latestFact("LinkedIn")?.value ?? "", fromNote: !!latestFact("LinkedIn") },
  ];

  return (
    <div className="space-y-6">
      <Link href="/relationships" className="text-sm font-medium text-indigo-700 hover:underline">
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

      <header className="rounded-2xl border border-stone-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          Relationship record
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{relationship.personLabel}</h1>
        {relationship.personLabelAuthority === "inferred-unverified" && (
          <p className="mt-1 text-xs text-amber-700">Name identified from a saved memory. Confirm or correct when you have a moment.</p>
        )}
        <div className="mt-5 grid gap-3 border-b border-stone-100 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          {contactDetails.map((item) => (
            <div key={item.label}>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{item.label}</p>
              <p className="mt-1 break-words text-sm text-stone-900">{item.value || <span className="text-stone-400">Not recorded</span>}</p>
              {item.value && item.fromNote && <p className="text-xs text-stone-500">From saved context (verify if needed)</p>}
            </div>
          ))}
        </div>
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
      </header>

      <section className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
        <h2 className="text-lg font-semibold">Where things stand</h2>
        <p className="mt-2 text-sm text-stone-700">
          {relationship.openLoops.length > 0
            ? relationship.openLoops.length + " recorded open commitment" + (relationship.openLoops.length === 1 ? "" : "s") + ". See the details below."
            : "No open commitments recorded. Nothing needs doing just because this person is in your relationships."}
        </p>
        {capturedNotes[0]?.summary && <p className="mt-2 text-sm text-stone-600">Latest remembered: {capturedNotes[0].summary}</p>}
      </section>

      <ConnectionSubjectsReview relationshipId={relationship.id} />
      <ConnectionJournal relationshipId={relationship.id} journeys={journeys} />

      <PersonConversationalCapture relationshipId={relationship.id} personLabel={relationship.personLabel} />

      <details className="rounded-2xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer font-medium text-indigo-700">Add a photo instead</summary>
        <div className="mt-3">
          <QuickCaptureForm contextRelationshipId={relationship.id} compact />
        </div>
      </details>

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
            Situations that are still moving and may create a natural future reason to engage.
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
                      Watch for: {thread.nextChangeSignal}
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
        <details className="rounded-xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Previously captured future signals ({relationship.stewardshipOpportunities.length})
          </summary>
          <p className="mt-2 text-xs text-stone-500">
            Historical possibilities, not evidence that the triggering event occurred. They are separate from current connection ideas above.
          </p>
          <ul className="mt-3 space-y-2">
            {relationship.stewardshipOpportunities.map((opportunity) => (
              <li key={opportunity.id} className="rounded-lg bg-stone-50 p-3 text-sm">
                <p className="font-medium text-stone-900">{opportunity.reason}</p>
                <p className="mt-1 text-stone-600">Watch for: {opportunity.trigger}</p>
                <p className="mt-1 text-xs text-stone-500">Captured {opportunity.observedAt}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {relationship.openLoops.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Open commitments</h2>
          <ul className="mt-4 space-y-3">
            {relationship.openLoops.map((loop) => (
              <li key={loop.commitment + loop.owner} className="rounded-xl bg-amber-50 p-4">
                <p className="font-medium text-amber-950">{loop.commitment}</p>
                <p className="mt-1 text-sm text-amber-800">{loop.owner} · {loop.status}</p>
              </li>
            ))}
          </ul>
        </section>
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
  );
}
