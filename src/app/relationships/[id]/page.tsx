import Link from "next/link";
import { notFound } from "next/navigation";
import { addTranscriptInteraction } from "../actions";
import { getRelationship } from "@/lib/relationship-store";

export const dynamic = "force-dynamic";

export default async function RelationshipDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  const { id } = await params;
  const { updated } = await searchParams;
  const relationship = await getRelationship(id);
  if (!relationship) notFound();

  const action = addTranscriptInteraction.bind(null, relationship.id);
  const primaryFacts = relationship.durableFacts.slice(0, 4);
  const additionalFacts = relationship.durableFacts.slice(4);
  const primaryThreads = relationship.activeThreads.slice(0, 3);
  const additionalThreads = relationship.activeThreads.slice(3);
  const primaryOpportunities = relationship.stewardshipOpportunities.slice(0, 3);
  const additionalOpportunities = relationship.stewardshipOpportunities.slice(3);

  return (
    <div className="space-y-6">
      <Link href="/relationships" className="text-sm font-medium text-indigo-700 hover:underline">
        ← Saved relationships
      </Link>

      {updated === "1" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Relationship updated. The transcript itself was not saved.
        </div>
      )}

      <header className="rounded-2xl border border-stone-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          Relationship record
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{relationship.personLabel}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
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
            <span className="text-stone-500">Relationship context not yet established.</span>
          )}
        </div>
        <p className="mt-4 text-sm text-stone-600">
          Last observed interaction: {relationship.lastInteractionAt ?? "Unknown"} · {relationship.sources.length} source
          {relationship.sources.length === 1 ? "" : "s"} represented
        </p>
      </header>

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

      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Possible reasons to engage</h2>
        <p className="mt-1 text-sm text-stone-600">
          Suggestions, not obligations. Silence is valid when there is no authentic reason to reach out.
        </p>
        {relationship.stewardshipOpportunities.length === 0 ? (
          <p className="mt-4 text-sm text-stone-500">No new stewardship opportunity captured yet.</p>
        ) : (
          <>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {primaryOpportunities.map((opportunity) => (
                <li key={opportunity.id} className="rounded-xl bg-indigo-50 p-4">
                  <p className="font-medium text-indigo-950">{opportunity.reason}</p>
                  <p className="mt-2 text-sm text-indigo-800">
                    Trigger: {opportunity.trigger}
                  </p>
                </li>
              ))}
            </ul>
            {additionalOpportunities.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-medium text-indigo-700">
                  {additionalOpportunities.length} more possible reasons
                </summary>
                <ul className="mt-3 space-y-2">
                  {additionalOpportunities.map((opportunity) => (
                    <li key={opportunity.id} className="rounded-xl bg-indigo-50 p-3 text-indigo-950">
                      {opportunity.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

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

      <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-6">
        <h2 className="text-lg font-semibold">Add a new conversation</h2>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Paste a transcript from a call or meeting. The transcript and this relationship&apos;s existing structured
          memory are sent to the configured inference model with provider storage disabled. Prior transcript text
          is not resent. Only the updated structured relationship memory is saved locally.
        </p>
        <form action={action} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-stone-700">
            Interaction date
            <input
              type="date"
              name="interactionDate"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="mt-1 block rounded-lg border border-stone-300 bg-white px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-stone-700">
            Transcript
            <textarea
              name="transcript"
              required
              rows={14}
              className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 font-mono text-sm"
              placeholder="Paste the call transcript here…"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800"
          >
            Learn from this interaction
          </button>
        </form>
      </section>

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
