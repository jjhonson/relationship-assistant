"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { beginConnection } from "../connection-actions";
import { dismissRelationshipConnectionIdea } from "../correction-actions";
import { reviewRelationshipConnection } from "../actions";
import type { ConnectionReview } from "@/lib/connection-subjects";

export default function ConnectionSubjectsReview({ relationshipId }: { relationshipId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tracking, startTracking] = useTransition();
  const [tracked, setTracked] = useState<string[]>([]);
  const [dismissing, startDismiss] = useTransition();
  const [review, setReview] = useState<ConnectionReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  function track(subject: string, basisId: string) {
    setError(null);
    startTracking(async () => {
      try {
        await beginConnection(relationshipId, subject, basisId);
        setTracked((current) => [...current, basisId]);
        router.refresh();
      } catch {
        setError("Could not start tracking this connection. No contact was made.");
      }
    });
  }

  function dismissSuggestion(basisId: string) {
    setError(null);
    startDismiss(async () => {
      try {
        await dismissRelationshipConnectionIdea(relationshipId, basisId);
        setReview((current) => {
          if (!current || current.kind !== "suggestions") return current;
          const suggestions = current.suggestions.filter((item) => item.basisId !== basisId);
          return suggestions.length ? { ...current, suggestions } : {
            ...current, kind: "no-suggestion", suggestions: [],
            noSuggestionReason: "No additional suggestions from this review. Dismissed ideas stay dismissed for their original evidence.",
          };
        });
        router.refresh();
      } catch {
        setError("Could not dismiss this suggestion. Nothing was changed.");
      }
    });
  }

  function requestReview() {
    setReview(null);
    setError(null);
    startTransition(async () => {
      try {
        setReview(await reviewRelationshipConnection(relationshipId));
      } catch {
        // Do not surface raw provider messages or any other confidential details.
        setError("The review couldn't be completed. Check the local model configuration and try again.");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-6">
      <h2 className="text-xl font-semibold text-stone-900">What could we connect over?</h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        Find a relevant subject, shared interest, or useful contribution from your saved history.
        This is about what might matter to this person, not which channel to use. No suggestion is a valid result.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={requestReview}
        className="mt-4 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Reviewing saved context…" : review ? "Review again" : "Find a reason to connect"}
      </button>
      <p className="mt-2 text-xs text-stone-500">
        Only when clicked, this sends bounded structured relationship memory to the configured AI model
        with provider storage disabled. It does not scan live email or a calendar, save the suggestions,
        or send anyone a message. Existing relationship-mode settings are not required.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      {review?.kind === "no-suggestion" && (
        <div aria-live="polite" className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <h3 className="font-semibold text-stone-900">Nothing compelling to suggest right now</h3>
          <p className="mt-1 text-sm text-stone-700">{review.noSuggestionReason}</p>
          <p className="mt-2 text-xs text-stone-500">Based on the saved evidence available on {review.reviewedAt}.</p>
        </div>
      )}
      {review?.kind === "suggestions" && (
        <div aria-live="polite" className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            A few possibilities · {review.reviewedAt}
          </p>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {review.suggestions.map((item) => (
              <li key={item.basisId} className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                <h3 className="font-semibold text-stone-900">{item.subject}</h3>
                <p className="mt-2 text-sm text-stone-700">{item.whyRelevant}</p>
                {item.possibleAngle && (
                  <p className="mt-2 text-sm text-stone-700">
                    <span className="font-medium">An angle to consider:</span> {item.possibleAngle}
                  </p>
                )}
                <details className="mt-3 border-t border-indigo-100 pt-2">
                  <summary className="cursor-pointer text-xs font-medium text-indigo-700">
                    Why did the agent suggest this?
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-stone-600">
                    {item.evidence.map((source) => {
                      const captureId = source.id.startsWith("capture:") ? source.id.slice("capture:".length) : null;
                      return (
                        <li key={source.id}>
                          {source.label} · {source.observedAt}
                          {captureId && (
                            <>
                              {" · "}
                              <Link href={"/captures/" + encodeURIComponent(captureId)}
                                className="font-medium text-indigo-700 hover:underline">
                                Review saved memory
                              </Link>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button"
                    onClick={() => track(item.subject, item.basisId)}
                    disabled={tracking || tracked.includes(item.basisId)}
                    className="rounded-lg border border-indigo-700 px-3 py-2 text-sm font-medium text-indigo-700 disabled:opacity-50">
                    {tracked.includes(item.basisId) ? "Tracking this idea" : tracking ? "Adding…" : "Track this idea"}
                  </button>
                  {tracked.includes(item.basisId) && (
                    <a href="#connection-activity" className="text-sm font-medium text-indigo-700 underline">
                      View connection activity
                    </a>
                  )}
                  <button type="button" disabled={dismissing || tracking}
                    onClick={() => dismissSuggestion(item.basisId)}
                    className="text-sm font-medium text-stone-600 hover:underline disabled:opacity-50">
                    {dismissing ? "Saving…" : "Not useful"}
                  </button>
                  {item.basisId.startsWith("commitment:") && (
                    <a href="#recorded-commitments" className="text-sm font-medium text-indigo-700 hover:underline">
                      Correct saved commitment
                    </a>
                  )}
                  {item.basisId.startsWith("opportunity:") && (
                    <a href="#future-signals" className="text-sm font-medium text-indigo-700 hover:underline">
                      Correct saved future signal
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-stone-500">
            These are ideas, not obligations. Verify older context before using it. No action has been taken.
          </p>
        </div>
      )}
    </section>
  );
}
