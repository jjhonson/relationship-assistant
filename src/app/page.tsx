import Link from "next/link";
import HomeCapture from "./HomeCapture";
import { selectHomeAttention, type HomeAttentionItem } from "@/lib/home-attention";
import { listRelationships } from "@/lib/relationship-store";

export const dynamic = "force-dynamic";

/** Reveal provenance on demand instead of repeating source explanations on every item. */
function EvidenceDetails({ item }: { item: HomeAttentionItem }) {
  return (
    <details className="mt-2 text-xs text-stone-600">
      <summary className="cursor-pointer font-medium text-indigo-700">Saved context</summary>
      <p className="mt-2">{item.detail}</p>
      <ul className="mt-1 space-y-1">
        {item.evidence.map((evidence) => {
          const captureId = evidence.id.startsWith("capture:") ? evidence.id.slice("capture:".length) : null;
          return (
            <li key={evidence.id}>
              {evidence.label} · {evidence.observedAt || "Date not recorded"}
              {captureId && (
                <>
                  {" · "}
                  <Link href={"/captures/" + encodeURIComponent(captureId)}
                    className="font-medium text-indigo-700 hover:underline">View note</Link>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export default async function HomePage() {
  const relationships = await listRelationships();
  const attention = selectHomeAttention(relationships, process.env.RELATIONSHIP_USER_LABEL ?? "Jason");
  const recentlyUpdated = [...relationships]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.personLabel.localeCompare(b.personLabel))
    .slice(0, 6);
  const noAttention = attention.commitments.length === 0 && attention.possibleSubjects.length === 0;

  return (
    <div className="space-y-9">
      <HomeCapture people={relationships.map((person) => ({
        id: person.id, label: person.personLabel,
      }))} />

      <section aria-labelledby="attention-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="attention-heading" className="text-xl font-semibold text-stone-900">
            Attention
          </h2>
          <details className="text-xs text-stone-600">
            <summary className="cursor-pointer font-medium text-indigo-700">About these items</summary>
            <p className="mt-2 max-w-sm">
              Based on earlier saved context, not a live inbox or calendar check.
              These are possibilities to review, never contact obligations.
            </p>
          </details>
        </div>

        {attention.commitments.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Recorded commitments
            </h3>
            <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white px-4">
              {attention.commitments.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-stone-500">{item.personLabel} · Needs verification</p>
                    <p className="mt-1 font-medium text-stone-900">{item.subject}</p>
                    <EvidenceDetails item={item} />
                  </div>
                  <Link href={"/relationships/" + encodeURIComponent(item.relationshipId)}
                    className="shrink-0 text-sm font-semibold text-indigo-700 hover:underline">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {attention.commitments.length === 0 && !noAttention && (
          <p className="text-sm text-stone-500">No recorded commitments flagged.</p>
        )}

        {attention.possibleSubjects.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Possible subjects to explore
            </h3>
            <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white px-4">
              {attention.possibleSubjects.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-stone-500">
                      {item.personLabel} · Previously recorded, not confirmed current
                    </p>
                    <p className="mt-1 font-medium text-stone-900">{item.subject}</p>
                    <EvidenceDetails item={item} />
                  </div>
                  <Link href={"/relationships/" + encodeURIComponent(item.relationshipId)}
                    className="shrink-0 text-sm font-semibold text-indigo-700 hover:underline">
                    Explore
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {noAttention && (
          <p className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
            Nothing in saved context needs review right now.
          </p>
        )}
      </section>

      <section aria-labelledby="people-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="people-heading" className="text-xl font-semibold">Relationships</h2>
            <p className="mt-1 text-sm text-stone-500">
              {relationships.length} saved {relationships.length === 1 ? "person" : "people"} ·
              Showing recently updated records
            </p>
          </div>
          <Link href="/relationships" className="text-sm font-semibold text-indigo-700 hover:underline">
            View all
          </Link>
        </div>
        {recentlyUpdated.length > 0 ? (
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {recentlyUpdated.map((person) => (
              <li key={person.id} className="border-b border-stone-200">
                <Link href={"/relationships/" + encodeURIComponent(person.id)}
                  className="flex items-center justify-between gap-3 py-3 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-700">
                  <span className="min-w-0">
                    <span className="block font-medium text-stone-900">{person.personLabel}</span>
                    {person.lastInteractionAt && (
                      <span className="mt-1 block text-xs text-stone-500">
                        Last recorded contact: {person.lastInteractionAt}
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="text-lg text-stone-400">›</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-600">No people saved yet. Start with a note above.</p>
        )}
      </section>

      <details className="text-xs text-stone-600">
        <summary className="cursor-pointer font-medium text-indigo-700">Development tools</summary>
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
