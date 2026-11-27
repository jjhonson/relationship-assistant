"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissRelationshipConnectionIdea } from "../correction-actions";
import { reviewRelationshipConnection } from "../actions";
import type { ConnectionReview } from "@/lib/connection-subjects";

/** Conversation context, not a queue of tasks to track. */
export default function ConnectionSubjectsReview({ relationshipId }: { relationshipId: string }) {
  const router = useRouter();
  const [review, setReview] = useState<ConnectionReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, beginReview] = useTransition();
  const [dismissing, beginDismiss] = useTransition();

  function requestReview() {
    setReview(null);
    setError(null);
    beginReview(async () => {
      try {
        setReview(await reviewRelationshipConnection(relationshipId));
      } catch {
        setError("The review could not be completed. Check the local model configuration and try again.");
      }
    });
  }

  function dismissSuggestion(basisId: string) {
    setError(null);
    beginDismiss(async () => {
      try {
        await dismissRelationshipConnectionIdea(relationshipId, basisId);
        setReview((current) => {
          if (!current || current.kind !== "suggestions") return current;
          const suggestions = current.suggestions.filter((item) => item.basisId !== basisId);
          return suggestions.length ? { ...current, suggestions } : {
            ...current,
            kind: "no-suggestion",
            suggestions: [],
            noSuggestionReason: "Nothing else worth suggesting from this review.",
          };
        });
        router.refresh();
      } catch {
        setError("The suggestion could not be dismissed. Nothing was changed.");
      }
    });
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-stone-900">Conversation ideas</h2>
      <p className="mt-1 text-sm text-stone-600">Get a few natural things to talk about when you next connect.</p>
      <button type="button" onClick={requestReview} disabled={reviewing || dismissing}
        className="mt-3 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {reviewing ? "Looking through saved context…" : review ? "Refresh ideas" : "Prepare for a conversation"}
      </button>
      <details className="mt-2 text-xs text-stone-500">
        <summary className="cursor-pointer">How suggestions are generated</summary>
        <p className="mt-1 max-w-3xl">
          Only when you ask, a bounded selection of saved relationship context is sent to the configured
          model with provider storage disabled. No live messages or calendar events are checked.
          No messages are sent and nothing is scheduled or monitored.
        </p>
      </details>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      {review?.kind === "no-suggestion" && (
        <div aria-live="polite" className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <p className="font-medium text-stone-900">Nothing especially compelling right now</p>
          <p className="mt-1 text-sm text-stone-600">{review.noSuggestionReason}</p>
        </div>
      )}
      {review?.kind === "suggestions" && (
        <div aria-live="polite" className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            From your saved conversations · {review.reviewedAt}
          </p>
          <ul className="mt-3 space-y-3">
            {review.suggestions.map((item) => (
              <li key={item.basisId} className="rounded-xl border border-stone-200 bg-stone-50/70 p-4">
                <h3 className="font-semibold text-stone-900">{item.subject}</h3>
                <p className="mt-2 text-sm text-stone-700">{item.whyRelevant}</p>
                {item.possibleAngle && (
                  <p className="mt-2 text-sm text-stone-800">
                    <span className="font-medium">You might ask:</span> {item.possibleAngle}
                  </p>
                )}
                <details className="mt-3 border-t border-stone-200 pt-2">
                  <summary className="cursor-pointer text-xs font-medium text-indigo-700">
                    Why this came to mind
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-stone-600">
                    {item.evidence.map((source) => {
                      const captureId = source.id.startsWith("capture:") ?
                        source.id.slice("capture:".length) : null;
                      return (
                        <li key={source.id}>
                          {source.label} · {source.observedAt}
                          {captureId && (
                            <>
                              {" · "}
                              <Link href={"/captures/" + encodeURIComponent(captureId)}
                                className="font-medium text-indigo-700 hover:underline">
                                View source
                              </Link>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                  <button type="button" disabled={dismissing || reviewing}
                    onClick={() => dismissSuggestion(item.basisId)}
                    className="font-medium text-stone-600 hover:underline disabled:opacity-50">
                    {dismissing ? "Saving…" : "Not relevant"}
                  </button>
                  {item.basisId.startsWith("commitment:") && (
                    <a href="#recorded-commitments" className="font-medium text-indigo-700 hover:underline">
                      Fix saved commitment
                    </a>
                  )}
                  {item.basisId.startsWith("opportunity:") && (
                    <a href="#future-signals" className="font-medium text-indigo-700 hover:underline">
                      Fix source memory
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-stone-500">
            Conversation possibilities, not tasks. It is fine to ask how something went when the outcome is unknown.
          </p>
        </div>
      )}
    </section>
  );
}
