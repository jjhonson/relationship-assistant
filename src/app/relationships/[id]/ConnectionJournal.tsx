"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { beginConnection, confirmConnectionActivity, previewConnectionActivity } from "../connection-actions";
import { connectionEventKinds, connectionEventLabel, connectionStatus,
  type ConnectionEventKind, type ConnectionJourney } from "@/lib/connection-journey";
import type { ConnectionEventPreview } from "@/lib/connection-update-inference";

const labels: Record<ConnectionEventKind, string> = {
  prepared: "Prepared, not sent",
  sent: "I sent it",
  reply_received: "They replied",
  meeting_scheduled: "We scheduled something",
  interaction_occurred: "We met or spoke",
  not_pursued: "I decided not to pursue it",
};

function JourneyEntry({ personId, journey }: { personId: string; journey: ConnectionJourney }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ConnectionEventPreview | null>(null);
  const [kind, setKind] = useState<ConnectionEventKind | "">("");
  const [date, setDate] = useState("");
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState("");
  const [reviewing, beginReview] = useTransition();
  const [saving, beginSave] = useTransition();

  function review() {
    setError("");
    setPreview(null);
    beginReview(async () => {
      try {
        const result = await previewConnectionActivity(personId, journey.id, text);
        setPreview(result);
        setKind(result.kind === "uncertain" ? "" : result.kind);
        setDate(result.happenedOn);
        setSummary(result.summary);
        setOutcome(result.outcome);
      } catch (cause) {
        setError(cause instanceof Error &&
          /pasted conversation|5,000 characters/i.test(cause.message)
          ? cause.message : "Could not interpret this update. Nothing was saved.");
      }
    });
  }

  function confirm() {
    if (!kind || !date || summary.trim().length < 4 || saving) return;
    setError("");
    beginSave(async () => {
      try {
        await confirmConnectionActivity(personId, journey.id, {
          kind, happenedOn: date, summary,
          outcome: kind === "reply_received" || kind === "interaction_occurred" ? outcome : "",
        });
        setText("");
        setPreview(null);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error && /date|summary|pasted conversation|action/i.test(cause.message)
          ? cause.message
          : "Save could not be confirmed. Check the timeline before retrying.");
      }
    });
  }

  return (
    <li className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-stone-900">{journey.subject}</h3>
          <p className="mt-1 text-xs text-stone-600">{connectionEventLabel(connectionStatus(journey))}</p>
        </div>
        <span className="text-xs text-stone-500">{journey.events.length} recorded update{journey.events.length === 1 ? "" : "s"}</span>
      </div>

      {journey.events.length > 0 && (
        <ol className="mt-3 space-y-2 border-l-2 border-stone-200 pl-3">
          {journey.events.map((event) => (
            <li key={event.id} className="text-sm">
              <p className="font-medium text-stone-800">
                {event.happenedOn} · {connectionEventLabel(event.kind)}
              </p>
              <p className="mt-1 text-stone-700">{event.summary}</p>
              {event.outcome && <p className="mt-1 text-stone-600">Remembered outcome: {event.outcome}</p>}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 space-y-2 border-t border-stone-200 pt-3">
        <label className="block text-sm font-medium text-stone-800" htmlFor={"connection-update-" + journey.id}>
          What happened next?
        </label>
        <textarea id={"connection-update-" + journey.id} rows={2} maxLength={5000}
          value={text} onChange={(e) => { setText(e.target.value); setPreview(null); setError(""); }}
          placeholder="I sent the article yesterday… or: We talked, and I learned that…"
          className="block w-full rounded-lg border border-stone-300 bg-white p-3 text-sm" />
        <button type="button" onClick={review} disabled={!text.trim() || reviewing || saving}
          className="rounded-lg border border-indigo-700 px-3 py-2 text-sm font-medium text-indigo-700 disabled:opacity-50">
          {reviewing ? "Reviewing…" : "Review update"}
        </button>
        {preview && (
          <div className="mt-3 space-y-3 rounded-xl border border-indigo-200 bg-white p-3">
            <p className="text-sm font-semibold text-stone-900">Check what will be recorded</p>
            {preview.question && <p className="text-xs text-stone-600">{preview.question}</p>}
            <label className="block text-sm font-medium">
              What actually happened?
              <select value={kind} onChange={(e) => setKind(e.target.value as ConnectionEventKind | "")}
                className="mt-1 block w-full rounded-lg border border-stone-300 p-2">
                <option value="">Choose the event (nothing inferred)</option>
                {connectionEventKinds.map((value) =>
                  <option key={value} value={value}>{labels[value]}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Date the action occurred
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="mt-1 block rounded-lg border border-stone-300 p-2" />
            </label>
            <label className="block text-sm font-medium">
              Summary in your words
              <textarea rows={2} maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-stone-300 p-2" />
            </label>
            {(kind === "reply_received" || kind === "interaction_occurred") && (
              <label className="block text-sm font-medium">
                New relationship context worth remembering (optional)
                <textarea rows={2} maxLength={500} value={outcome} onChange={(e) => setOutcome(e.target.value)}
                  placeholder="Tom hopes to play an open mic one day (not scheduled yet)."
                  className="mt-1 block w-full rounded-lg border border-stone-300 p-2" />
              </label>
            )}
            <p className="text-xs text-stone-500">
              Only this confirmed summary and any new context are stored, not your original input.
              No message is sent or verified.
            </p>
            <button type="button" onClick={confirm}
              disabled={!kind || !date || summary.trim().length < 4 || saving}
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
      <p className="mt-2 text-sm text-stone-600">
        Keep track of what you actually did and what happened. A suggestion or draft is not a sent message.
      </p>
      {journeys.length > 0 && (
        <ul className="mt-4 space-y-4">
          {journeys.map((journey) =>
            <JourneyEntry key={journey.id} personId={relationshipId} journey={journey} />)}
        </ul>
      )}
      {journeys.length === 0 && (
        <p className="mt-4 text-sm text-stone-500">
          No connections tracked yet. You can start one below, even without an agent suggestion.
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
              placeholder="Share the article about learning guitar"
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
