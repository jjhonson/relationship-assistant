import Link from "next/link";
import HomeCapture from "./HomeCapture";
import { selectHomeAttention, type HomeAttentionItem } from "@/lib/home-attention";
import { listPersonalMoments, listRelationships } from "@/lib/relationship-store";

export const dynamic = "force-dynamic";

function EvidenceNote({ item }: { item: HomeAttentionItem }) {
  const evidence = item.evidence[0];
  if (!evidence) return null;
  const captureId = evidence.id.startsWith("capture:") ? evidence.id.slice("capture:".length) : null;
  return (
    <p className="mt-2 text-xs text-stone-500">
      Saved evidence: {evidence.label} · {evidence.observedAt || "Date not recorded"}
      {captureId && (
        <>
          {" · "}
          <Link className="font-medium text-indigo-700 hover:underline"
            href={"/captures/" + encodeURIComponent(captureId)}>View note</Link>
        </>
      )}
    </p>
  );
}

export default async function HomePage() {
  const [relationships, moments] = await Promise.all([listRelationships(), listPersonalMoments()]);
  const attention = selectHomeAttention(relationships, process.env.RELATIONSHIP_USER_LABEL ?? "Jason");
  const recentlyUpdated = [...relationships]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.personLabel.localeCompare(b.personLabel))
    .slice(0, 6);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Personal alpha</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Home</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          A place to remember what happened and consider where your attention might be useful.
          No relationship scores, forced contact cadence or automatic outreach.
        </p>
      </header>

      <HomeCapture people={relationships.map((person) => ({
        id: person.id, label: person.personLabel,
      }))} />

      <section aria-labelledby="attention-heading" className="space-y-4">
        <div>
          <h2 id="attention-heading" className="text-xl font-semibold text-stone-900">Worth your attention</h2>
          <p className="mt-1 text-sm text-stone-600">
            A small review of your saved context, not a live inbox or calendar scan.
            Earlier information may have changed. Nothing here requires you to contact someone.
          </p>
        </div>

        {attention.commitments.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-600">Recorded commitments to review</h3>
            {attention.commitments.map((item) => (
              <div key={item.id} className="rounded-xl border border-stone-200 bg-white p-4">
                <p className="text-xs font-medium text-indigo-700">{item.personLabel}</p>
                <p className="mt-1 font-medium text-stone-900">{item.subject}</p>
                <p className="mt-1 text-sm text-stone-600">{item.detail}</p>
                <EvidenceNote item={item} />
                <Link href={"/relationships/" + encodeURIComponent(item.relationshipId)}
                  className="mt-3 inline-block text-sm font-semibold text-indigo-700 hover:underline">
                  Review context
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="font-medium text-stone-900">No source-backed commitments flagged for review.</p>
            <p className="mt-1 text-sm text-stone-600">
              That is based only on saved evidence. It does not mean there are no other things happening.
            </p>
          </div>
        )}

        {attention.possibleSubjects.length > 0 && (
          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-600">Possible subjects to explore</h3>
            <p className="text-sm text-stone-600">
              These are previously recorded threads, not newly verified events or suggested obligations.
              Open a person to request an evidence-backed connection review.
            </p>
            <ul className="grid gap-3 md:grid-cols-2">
              {attention.possibleSubjects.map((item) => (
                <li key={item.id} className="rounded-xl border border-stone-200 bg-white p-4">
                  <p className="text-xs font-medium text-indigo-700">{item.personLabel}</p>
                  <h4 className="mt-1 font-semibold text-stone-900">{item.subject}</h4>
                  <p className="mt-1 line-clamp-3 text-sm text-stone-600">{item.detail}</p>
                  <EvidenceNote item={item} />
                  <Link href={"/relationships/" + encodeURIComponent(item.relationshipId)}
                    className="mt-3 inline-block text-sm font-semibold text-indigo-700 hover:underline">
                    Explore with this person
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {attention.commitments.length === 0 && attention.possibleSubjects.length === 0 && (
          <p className="text-sm text-stone-600">
            Nothing else stands out from saved context. You can still look up a person or save a new moment.
          </p>
        )}
      </section>

      <section aria-labelledby="people-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="people-heading" className="text-xl font-semibold">Your relationships</h2>
            <p className="mt-1 text-sm text-stone-600">
              {relationships.length} saved {relationships.length === 1 ? "person" : "people"}.
              These are your current records, not the fictional demonstration contacts.
            </p>
          </div>
          <Link href="/relationships" className="text-sm font-semibold text-indigo-700 hover:underline">
            View all people
          </Link>
        </div>
        {recentlyUpdated.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentlyUpdated.map((person) => (
              <li key={person.id}>
                <Link href={"/relationships/" + encodeURIComponent(person.id)}
                  className="block h-full rounded-xl border border-stone-200 bg-white p-4 hover:border-indigo-300 focus-visible:outline-2 focus-visible:outline-indigo-700">
                  <h3 className="font-semibold text-stone-900">{person.personLabel}</h3>
                  <p className="mt-1 text-xs text-stone-600">
                    {person.labelAuthority === "user-confirmed" && person.relationshipContexts.length
                      ? person.relationshipContexts.join(" · ")
                      : "Relationship context needs review"}
                  </p>
                  <p className="mt-2 text-xs text-stone-500">
                    {person.lastInteractionAt ? "Last recorded interaction: " + person.lastInteractionAt
                      : "No recorded interaction date"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
            No people saved yet. Start with your own note above or visit People to create a record.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-stone-900">Your moments</h2>
            <p className="mt-1 text-sm text-stone-600">
              {moments.length} saved. Private unless you deliberately enable an optional connection review.
            </p>
          </div>
          <Link href="/moments" className="shrink-0 text-sm font-semibold text-indigo-700 hover:underline">
            View moments
          </Link>
        </div>
      </section>

      <details className="text-sm text-stone-600">
        <summary className="cursor-pointer font-medium text-indigo-700">Development experiments</summary>
        <nav aria-label="Development experiments" className="mt-3 flex flex-wrap gap-4">
          <Link href="/discover" className="hover:underline">Gmail discovery</Link>
          <Link href="/pilot" className="hover:underline">Fictional context pilot</Link>
          <Link href="/real-pilot" className="hover:underline">Real-contact pilot</Link>
          <Link href="/gmail" className="hover:underline">Gmail proof of concept</Link>
        </nav>
      </details>
    </div>
  );
}
