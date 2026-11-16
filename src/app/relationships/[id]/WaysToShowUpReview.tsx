"use client";

import { useState, useTransition } from "react";
import { reviewRelationshipWays } from "../actions";
import type { StewardshipReview } from "@/lib/relationship-stewardship";

export default function WaysToShowUpReview({
  relationshipId,
  hasIntention,
}: {
  relationshipId: string;
  hasIntention: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [review, setReview] = useState<StewardshipReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestReview = () => {
    setReview(null);
    setError(null);
    startTransition(async () => {
      try {
        setReview(await reviewRelationshipWays(relationshipId));
      } catch {
        setError("The review couldn't be completed. Check the local model configuration and try again.");
      }
    });
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending || !hasIntention}
        onClick={requestReview}
        className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {pending ? "Reviewing relationship…" : review ? "Review again" : "Review ways to show up"}
      </button>
      <p className="mt-2 text-xs text-stone-500">
        {hasIntention
          ? "Only when you click, this sends saved structured relationship memory to the configured AI model (provider storage disabled). No raw transcripts or live email are read. No message is sent and no recommendation is saved."
          : "Choose a relationship mode above to enable a review. Reviews send structured memory to the configured AI model only when requested."}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      {review?.kind === "no-action" && (
        <div aria-live="polite" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="font-semibold text-emerald-950">No action suggested</h3>
          <p className="mt-1 text-sm text-emerald-900">{review.noActionReason}</p>
          <p className="mt-3 text-xs text-emerald-800">Based on saved memory as of {review.reviewedAt}.</p>
        </div>
      )}
      {review?.kind === "recommendations" && (
        <div aria-live="polite" className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Worth considering · {review.reviewedAt}
          </p>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {review.recommendations.map((item) => (
              <li key={item.basisId} className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                <h3 className="font-semibold text-indigo-950">{item.action}</h3>
                <p className="mt-2 text-sm text-stone-800">{item.whyNow}</p>
                <p className="mt-3 text-xs text-indigo-700">
                  Evidence: {item.evidence.map((source) => `${source.label} (${source.observedAt})`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-stone-500">
            Suggestions are possibilities, not obligations. Check the actual situation before acting.
          </p>
        </div>
      )}
    </div>
  );
}
