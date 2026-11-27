import Link from "next/link";
import { dismissHomeOpportunity } from "./home/opportunity-actions";
import {
  homeInteractionDate, homeRelationshipDetail,
  orderHomeRelationships, selectHomeOpportunities,
} from "@/lib/home-view";
import { listRelationships } from "@/lib/relationship-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const people = await listRelationships();
  const opportunities = selectHomeOpportunities(people, process.env.RELATIONSHIP_USER_LABEL ?? "Jason");
  const relationships = orderHomeRelationships(people);

  return (
    <div className="space-y-14 pb-16 sm:space-y-16">
      <section aria-labelledby="opportunities-heading" className="mx-auto max-w-4xl space-y-5">
        <h2 id="opportunities-heading"
          className="text-lg font-semibold tracking-tight text-stone-900">
          Opportunities to connect
        </h2>

        {opportunities.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {opportunities.map((item) => (
              <li key={item.id} className="flex flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
                <p className="text-xs font-medium text-stone-500">{item.personLabel} · {item.kind === "commitment" ? "Your commitment" : "Catch up"}</p>
                <h3 className="mt-1 text-base font-medium leading-snug text-stone-900">
                  {item.topic}
                </h3>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-stone-600">
                  {item.context}
                </p>
                {item.evidence.length > 0 && <details className="mt-3 text-xs text-stone-500">
                  <summary className="cursor-pointer font-medium hover:text-stone-800">
                    Why this came to mind
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {item.evidence.map((source) => {
                      const captureId = source.id.startsWith("capture:") ?
                        source.id.slice("capture:".length) : null;
                      return (
                        <li key={source.id}>
                          <span>{source.label} · {source.observedAt || "Date not recorded"}</span>
                          {captureId && (
                            <>
                              {" · "}
                              <Link href={"/captures/" + encodeURIComponent(captureId)}
                                className="underline underline-offset-2 hover:text-stone-800">
                                Source
                              </Link>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>}
                <div className="mt-auto flex items-center justify-between gap-3 pt-5 text-sm">
                  <Link href={"/relationships/" + encodeURIComponent(item.relationshipId)}
                    className="font-medium text-stone-800 underline-offset-4 hover:underline">
                    View relationship <span aria-hidden="true">↗</span>
                  </Link>
                  <form action={dismissHomeOpportunity.bind(null, item.relationshipId, item.basisId)}>
                    <button type="submit"
                      className="text-xs text-stone-500 underline-offset-4 hover:text-stone-800 hover:underline">
                      Not relevant
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">Nothing worth suggesting yet.</p>
        )}
      </section>

      <section aria-labelledby="relationships-heading" className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="relationships-heading"
              className="text-lg font-semibold tracking-tight text-stone-900">
              Your relationships
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {relationships.length} {relationships.length === 1 ? "person" : "people"}
            </p>
          </div>
          <Link href="/relationships"
            className="text-sm font-medium text-stone-700 underline-offset-4 hover:underline">
            Browse all <span aria-hidden="true">↗</span>
          </Link>
        </div>
        {relationships.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {relationships.map((person) => {
              const detail = homeRelationshipDetail(person);
              return (
                <li key={person.id}>
                  <Link href={"/relationships/" + encodeURIComponent(person.id)}
                    className="group flex h-full items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white px-4 py-3.5 transition-colors hover:border-stone-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-stone-900">{person.personLabel}</span>
                      {detail && (
                        <span className="mt-0.5 block truncate text-xs text-stone-500">{detail}</span>
                      )}
                      {person.lastInteractionAt && (
                        <span className="mt-1 block text-xs text-stone-400">
                          Last spoke {homeInteractionDate(person.lastInteractionAt)}
                        </span>
                      )}
                    </span>
                    <span aria-hidden="true" className="shrink-0 text-stone-400 group-hover:text-stone-800">↗</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">
            No relationships saved yet. You can start by remembering a conversation above.
          </p>
        )}
      </section>

      <details className="mx-auto max-w-4xl border-t border-stone-200 pt-4 text-xs text-stone-500">
        <summary className="cursor-pointer hover:text-stone-800">Development tools</summary>
        <nav aria-label="Development experiments" className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/discover" className="hover:underline">Gmail discovery</Link>
          <Link href="/pilot" className="hover:underline">Fictional pilot</Link>
          <Link href="/real-pilot" className="hover:underline">Real-data pilot (not ready)</Link>
          <Link href="/gmail" className="hover:underline">Gmail proof of concept</Link>
        </nav>
      </details>
    </div>
  );
}
