"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { reviewUserMoment } from "../actions";
import type { MomentPeopleReview } from "@/lib/moment-people";

export default function MomentPeopleReview({ momentId }: { momentId: string }) {
  const [pending, startTransition] = useTransition();
  const [review, setReview] = useState<MomentPeopleReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  function findPeople() {
    setReview(null);
    setError(null);
    startTransition(async () => {
      try {
        setReview(await reviewUserMoment(momentId));
      } catch {
        setError("The review couldn't be completed. Check the local model configuration and try again.");
      }
    });
  }

  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
      <button
        type="button"
        disabled={pending}
        onClick={findPeople}
        className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
      >
        {pending ? "Looking for a genuine connection…" : review ? "Review again" : "Who might appreciate this?"}
      </button>
      <p className="mt-2 text-xs text-stone-500">
        Only on this click, your saved words and a small amount of sourced relationship memory go
        to the configured AI model (provider storage disabled). No live links are opened by the agent.
        Nothing is sent to another person and no outreach is recorded.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      {review?.kind === "no-match" && (
        <div aria-live="polite" className="mt-3 rounded-lg bg-stone-50 p-3 text-sm">
          <strong className="text-stone-900">No compelling match right now.</strong>
          <p className="mt-1 text-stone-600">{review.noMatchReason}</p>
          <p className="mt-1 text-xs text-stone-500">Reviewed {review.reviewedAt}. The moment remains saved.</p>
        </div>
      )}
      {review?.kind === "matches" && (
        <div aria-live="polite" className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Possible one-to-one connections · {review.reviewedAt}
          </p>
          <ul className="mt-2 space-y-3">
            {review.matches.map((match) => (
              <li key={match.relationshipId} className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                <Link href={"/relationships/" + encodeURIComponent(match.relationshipId)}
                  className="font-semibold text-indigo-800 hover:underline">
                  {match.personLabel}
                </Link>
                <p className="mt-2 text-sm text-stone-800">{match.reason}</p>
                {match.possibleAngle && (
                  <p className="mt-2 text-sm text-stone-700">
                    <strong>Possible angle:</strong> {match.possibleAngle}
                  </p>
                )}
                <details className="mt-3 text-xs text-stone-600">
                  <summary className="cursor-pointer font-medium text-indigo-700">
                    Why this person? Review source
                  </summary>
                  <p className="mt-2">Based on your saved moment and this person's dated history:</p>
                  <ul className="mt-1 space-y-1">
                    {match.evidence.map((source) => {
                      const captureId = source.id.startsWith("capture:") ?
                        source.id.slice("capture:".length) : null;
                      return (
                        <li key={source.id}>
                          {source.label} · {source.observedAt}
                          {captureId && (
                            <>
                              {" · "}
                              <Link className="font-medium text-indigo-700 hover:underline"
                                href={"/captures/" + encodeURIComponent(captureId)}>
                                Open saved memory
                              </Link>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">
            These are possibilities, not obligations or automatic recommendations to share an item.
            No message has been prepared or sent.
          </p>
        </div>
      )}
    </div>
  );
}
