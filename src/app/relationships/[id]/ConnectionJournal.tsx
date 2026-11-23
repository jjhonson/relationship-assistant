"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  beginConnection, confirmMultipleConnectionActivities, previewMultipleConnectionActivities,
} from "../connection-actions";
import {
  connectionEventKinds, connectionEventLabel, connectionStatus,
  type ConfirmedConnectionEvent, type ConnectionEventKind, type ConnectionJourney,
} from "@/lib/connection-journey";
import type { ConnectionEventPreview } from "@/lib/connection-update-inference";

const labels: Record<ConnectionEventKind, string> = {
  prepared: "Prepared, not sent",
  sent: "Message sent",
  reply_received: "Reply received",
  meeting_scheduled: "Meeting scheduled",
  interaction_occurred: "Conversation or meeting happened",
  not_pursued: "Decided not to pursue",
};

type DraftEvent = ConnectionEventPreview & { id: string; editing: boolean };

function eventLabel(kind: ConnectionEventKind | "uncertain") {
  return kind === "uncertain" ? "Needs clarification" : labels[kind];
}

function JourneyEntry({ personId, journey }: { personId: string; journey: ConnectionJourney }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [drafts, setDrafts] = useState<DraftEvent[]>([]);
  const [question, setQuestion] = useState("");
  const [confirmationId, setConfirmationId] = useState("");
  const [error, setError] = useState("");
  const [reviewing, beginReview] = useTransition();
  const [saving, beginSave] = useTransition();

  function changeText(value: string) {
    setText(value);
    setReviewed(false);
    setDrafts([]);
    setQuestion("");
    setConfirmationId("");
    setError("");
  }

  function review() {
    if (!text.trim()) return;
    setError("");
    setReviewed(false);
    beginReview(async () => {
      try {
        const result = await previewMultipleConnectionActivities(personId, journey.id, text);
        setDrafts(result.events.map((event) => ({
          ...event,
          id: crypto.randomUUID(),
          editing: event.kind === "uncertain" || !event.happenedOn || event.summary.length < 4,
        })));
        setQuestion(result.question);
        setConfirmationId(crypto.randomUUID());
        setReviewed(true);
      } catch (cause) {
        const message = cause instanceof Error && /pasted conversation|5,000 characters/i.test(cause.message)
          ? cause.message : "Could not interpret this update. Nothing was saved.";
        setError(message);
      }
    });
  }

  function update(id: string, changes: Partial<DraftEvent>) {
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
    setError("");
  }

  function reorder(id: string, direction: -1 | 1) {
    setDrafts((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index < 0 || index + direction < 0 || index + direction >= current.length) return current;
      const ordered = [...current];
      [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
      return ordered;
    });
  }

  const ready = reviewed && drafts.length > 0 && !!confirmationId &&
    drafts.every((item) => item.kind !== "uncertain" && !!item.happenedOn &&
      item.summary.trim().length >= 4 && item.summary.length <= 500 && item.outcome.length <= 500) &&
    !reviewing && !saving;

  function confirm() {
    if (!ready) return;
    const events: ConfirmedConnectionEvent[] = drafts.map((item) => ({
      kind: item.kind as ConnectionEventKind,
      happenedOn: item.happenedOn,
      summary: item.summary.trim(),
      outcome: item.kind === "reply_received" || item.kind === "interaction_occurred"
        ? item.outcome.trim() : "",
    }));
    setError("");
    beginSave(async () => {
      try {
        await confirmMultipleConnectionActivities(personId, journey.id, events, confirmationId);
        setText("");
        setReviewed(false);
        setDrafts([]);
        setQuestion("");
        setConfirmationId("");
        router.refresh();
      } catch (cause) {
        const message = cause instanceof Error &&
          /date|summary|pasted|confirmation|event|outcome|status|different update|choose/i.test(cause.message)
          ? cause.message : "Save could not be confirmed. Review the history before retrying.";
        setError(message);
      }
    });
  }

  const mostRecent = journey.events.at(-1);

  return (
    <li className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-stone-900">{journey.subject}</h3>
          <p className="mt-1 text-xs text-stone-600">{connectionEventLabel(connectionStatus(journey))}</p>
          {mostRecent && <p className="mt-2 text-sm text-stone-700">{mostRecent.summary}</p>}
        </div>
      </div>

      {journey.events.length > 0 && (
        <details className="mt-3 border-t border-stone-200 pt-3">
          <summary className="cursor-pointer text-sm font-medium text-indigo-700">
            History ({journey.events.length})
          </summary>
          <ol className="mt-3 space-y-3 border-l-2 border-stone-200 pl-3">
            {journey.events.map((event) => (
              <li key={event.id} className="text-sm">
                <p className="font-medium text-stone-800">
                  {event.happenedOn} · {connectionEventLabel(event.kind)}
                </p>
                <p className="mt-1 text-stone-700">{event.summary}</p>
                {event.outcome && <p className="mt-1 text-stone-600">Learned: {event.outcome}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="mt-4 space-y-3 border-t border-stone-200 pt-4">
        <label className="block text-sm font-medium text-stone-800" htmlFor={"connection-update-" + journey.id}>
          What happened?
        </label>
        <textarea id={"connection-update-" + journey.id} rows={3} maxLength={5000}
          value={text} onChange={(e) => changeText(e.target.value)}
          placeholder="I sent Judy a note, she replied, and we talked about some local 5K races…"
          className="block w-full rounded-lg border border-stone-300 bg-white p-3 text-sm" />
        <button type="button" onClick={review} disabled={!text.trim() || reviewing || saving}
          className="rounded-lg border border-indigo-700 px-3 py-2 text-sm font-medium text-indigo-700 disabled:opacity-50">
          {reviewing ? "Interpreting…" : "Review what happened"}
        </button>

        {reviewed && (
          <div aria-live="polite" className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4">
            <h4 className="font-semibold text-stone-900">Check what I understood</h4>
            {question && <p className="text-sm text-stone-700">{question}</p>}
            {drafts.length === 0 && (
              <p className="text-sm text-stone-600">
                Nothing confirmed as having happened yet. Add a little more detail and review again.
              </p>
            )}
            {drafts.length > 0 && (
              <ol className="space-y-3">
                {drafts.map((item, index) => (
                  <li key={item.id} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-indigo-700">
                          {index + 1}. {eventLabel(item.kind)} · {item.happenedOn || "Date needed"}
                        </p>
                        <p className="mt-1 text-sm text-stone-900">{item.summary || "Summary needed"}</p>
                        {item.outcome && <p className="mt-1 text-xs text-stone-600">
                          New context: {item.outcome}
                        </p>}
                        {item.question && <p className="mt-2 text-xs text-amber-700">{item.question}</p>}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs">
                        <button type="button" onClick={() => update(item.id, { editing: !item.editing })}
                          className="font-medium text-indigo-700 hover:underline">
                          {item.editing ? "Close" : "Edit"}
                        </button>
                        <button type="button" onClick={() =>
                          setDrafts((current) => current.filter((row) => row.id !== item.id))}
                          className="font-medium text-stone-600 hover:underline">Remove</button>
                      </div>
                    </div>

                    {item.editing && (
                      <div className="mt-3 grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2">
                        <label className="text-sm font-medium text-stone-800">
                          Event
                          <select value={item.kind}
                            onChange={(e) => {
                              const kind = e.target.value as ConnectionEventKind | "uncertain";
                              update(item.id, { kind,
                                outcome: kind === "reply_received" || kind === "interaction_occurred" ?
                                  item.outcome : "" });
                            }}
                            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2">
                            <option value="uncertain">Needs clarification</option>
                            {connectionEventKinds.map((kind) =>
                              <option key={kind} value={kind}>{labels[kind]}</option>)}
                          </select>
                        </label>
                        <label className="text-sm font-medium text-stone-800">
                          Date of action
                          <input type="date" value={item.happenedOn}
                            onChange={(e) => update(item.id, { happenedOn: e.target.value })}
                            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2" />
                        </label>
                        <label className="text-sm font-medium text-stone-800 sm:col-span-2">
                          Summary
                          <textarea rows={2} maxLength={500} value={item.summary}
                            onChange={(e) => update(item.id, { summary: e.target.value })}
                            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2" />
                        </label>
                        {(item.kind === "reply_received" || item.kind === "interaction_occurred") && (
                          <label className="text-sm font-medium text-stone-800 sm:col-span-2">
                            New person-specific context (optional)
                            <textarea rows={2} maxLength={500} value={item.outcome}
                              onChange={(e) => update(item.id, { outcome: e.target.value })}
                              className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2" />
                          </label>
                        )}
                        {drafts.length > 1 && (
                          <div className="flex gap-3 text-xs sm:col-span-2">
                            <button type="button" disabled={index === 0} onClick={() => reorder(item.id, -1)}
                              className="text-indigo-700 disabled:opacity-30">Move up</button>
                            <button type="button" disabled={index === drafts.length - 1}
                              onClick={() => reorder(item.id, 1)}
                              className="text-indigo-700 disabled:opacity-30">Move down</button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}

            <p className="text-xs text-stone-500">
              This records only the actions you confirm, not a raw transcript. A reply, send or meeting
              is user-reported, not externally verified.
            </p>
            {drafts.some((item) => item.kind === "uncertain" || !item.happenedOn) && (
              <p className="text-xs font-medium text-amber-700">
                Clarify the action and date of each remaining item before saving.
              </p>
            )}
            <button type="button" disabled={!ready} onClick={confirm}
              className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Saving…" : "Confirm and record"}
            </button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
    </li>
  );
}

export default function ConnectionJournal({
  relationshipId, journeys,
}: { relationshipId: string; journeys: ConnectionJourney[] }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [error, setError] = useState("");
  const [pending, begin] = useTransition();

  function create() {
    setError("");
    begin(async () => {
      try {
        await beginConnection(relationshipId, subject);
        setSubject("");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error && /subject|relationship/i.test(cause.message)
          ? cause.message : "Could not start the connection.");
      }
    });
  }

  return (
    <section id="connection-activity" className="rounded-2xl border border-stone-200 bg-white p-6">
      <h2 className="text-xl font-semibold">Connection activity</h2>
      <p className="mt-1 text-sm text-stone-600">
        Describe one exchange in your own words, even if several things happened.
      </p>
      {journeys.length > 0 && (
        <ul className="mt-4 space-y-4">
          {journeys.map((journey) =>
            <JourneyEntry key={journey.id} personId={relationshipId} journey={journey} />)}
        </ul>
      )}
      {journeys.length === 0 && (
        <p className="mt-4 text-sm text-stone-500">
          No connections tracked yet. Start independently below or track a suggested idea above.
        </p>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-indigo-700">
          Start a connection independently
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="min-w-56 flex-1 text-sm">
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160}
              placeholder="Share an interesting guitar article"
              className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2" />
          </label>
          <button type="button" onClick={create} disabled={subject.trim().length < 3 || pending}
            className="self-end rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Starting…" : "Start"}
          </button>
        </div>
      </details>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    </section>
  );
}
