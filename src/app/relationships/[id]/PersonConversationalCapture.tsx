"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  previewPersonCapture,
  saveReviewedPersonCapture,
} from "@/app/relationships/conversational-actions";
import type { CaptureInterpretation, CaptureKind, CaptureSource } from "@/lib/conversational-capture";
import { PASTED_CONVERSATION_SOURCES } from "@/lib/pasted-conversation";

type ConfirmedKind = Exclude<CaptureKind, "uncertain">;
const kinds: Array<{ value: ConfirmedKind; label: string }> = [
  { value: "conversation", label: "A pasted conversation or transcript" },
  { value: "note", label: "My own note about this person" },
  { value: "moment", label: "My own personal moment or idea" },
];

function kindLabel(kind: CaptureKind) {
  if (kind === "conversation") return "a pasted conversation";
  if (kind === "note") return "your own note about this person";
  if (kind === "moment") return "your own personal moment";
  return "something that needs clarification";
}

export default function PersonConversationalCapture({
  relationshipId, personLabel,
}: { relationshipId: string; personLabel: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [interpretation, setInterpretation] = useState<CaptureInterpretation | null>(null);
  const [kind, setKind] = useState<ConfirmedKind | "">("");
  const [source, setSource] = useState<CaptureSource>("unspecified");
  const [interactionDate, setInteractionDate] = useState("");
  const [reviewPending, startReview] = useTransition();
  const [savePending, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resetPreview(nextText: string) {
    setText(nextText);
    setInterpretation(null);
    setKind("");
    setError(null);
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) { setError("Paste a conversation or describe what you want to remember."); return; }
    setError(null);
    startReview(async () => {
      try {
        const result = await previewPersonCapture(relationshipId, text);
        setInterpretation(result);
        setKind(result.kind === "uncertain" ? "" : result.kind);
        setSource(result.source);
        setInteractionDate(result.interactionDate);
      } catch {
        setError("Unable to interpret this text. Check the local AI configuration and try again. Nothing was saved.");
      }
    });
  }

  function save() {
    if (!interpretation || !kind) { setError("Choose whether this is a conversation, note or personal moment."); return; }
    if (kind === "conversation" && !interactionDate) {
      setError("When did this conversation happen? Add the date before saving.");
      return;
    }
    if (kind === "moment" && text.trim().length > 1000) {
      setError("Personal moments currently support up to 1,000 characters.");
      return;
    }
    if (kind === "note" && text.trim().length > 5000) {
      setError("Personal notes currently support up to 5,000 characters.");
      return;
    }
    setError(null);
    startSave(async () => {
      let destination: string;
      try {
        const saved = await saveReviewedPersonCapture(relationshipId, {
          text, kind, source, interactionDate,
        });
        destination = saved.destination;
      } catch (cause) {
        setError(cause instanceof Error && /up to \d|valid conversation date/i.test(cause.message)
          ? cause.message
          : "Save could not be confirmed. Check the saved record before retrying to avoid duplicates.");
        return;
      }
      // Navigate only after a confirmed save, outside the error handler.
      router.push(destination);
    });
  }

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">One place to remember</p>
      <h2 className="mt-1 text-xl font-semibold text-stone-900">What do you want to remember?</h2>
      <p className="mt-2 text-sm text-stone-600">
        Paste a chat, email, meeting transcript, or simply describe something about {personLabel}.
        Add natural context if you have it, such as &ldquo;I just finished a meeting.&rdquo;
        No source or date form to fill out first.
      </p>
      <form onSubmit={review} className="mt-4 space-y-3">
        <label htmlFor="conversation-memory-input" className="block text-sm font-medium text-stone-700">
          Your words or pasted material
        </label>
        <textarea
          id="conversation-memory-input"
          name="text"
          value={text}
          onChange={(event) => resetPreview(event.target.value)}
          maxLength={80000}
          rows={6}
          required
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm"
          placeholder={"Just finished a meeting with " + personLabel + ". Here's the transcript:\n\n..."}
        />
        <button type="submit" disabled={reviewPending || savePending}
          className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-60">
          {reviewPending ? "Understanding your note…" : "Review what I understood"}
        </button>
      </form>
      <p className="mt-2 text-xs text-stone-500">
        The AI interprets this only when you click Review, with provider storage disabled.
        Nothing is saved until you confirm. Pasted conversations are not retained verbatim.
      </p>

      {interpretation && (
        <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4" aria-live="polite">
          <h3 className="text-sm font-semibold text-stone-900">Here&apos;s what I understood</h3>
          <p className="mt-2 text-sm text-stone-800">
            This looks like <strong>{kindLabel(interpretation.kind)}</strong> involving {personLabel}.
          </p>
          {interpretation.summary && <p className="mt-2 text-sm text-stone-700">{interpretation.summary}</p>}

          {(interpretation.kind === "uncertain" || !kind) && (
            <label className="mt-4 block text-sm font-medium text-stone-800">
              Is this copied conversation material or your own writing?
              <select value={kind} onChange={(event) => {
                const next = event.target.value as ConfirmedKind | "";
                setKind(next); setError(null);
              }} className="mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                <option value="">Choose the correct kind</option>
                {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          )}

          {kind === "conversation" && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-stone-700">
                Source: <strong>{PASTED_CONVERSATION_SOURCES.find((item) => item.value === source)?.label ??
                  "Source unspecified"}</strong> (inferred from what you pasted, not independently verified)
              </p>
              {!interactionDate && (
                <label className="block text-sm font-medium text-stone-800">
                  {interpretation.question || "When did this conversation happen?"}
                  <input type="date" value={interactionDate}
                    onChange={(event) => { setInteractionDate(event.target.value); setError(null); }}
                    className="mt-2 block rounded-lg border border-stone-300 bg-white px-3 py-2" />
                </label>
              )}
              {interactionDate && <p className="text-sm text-stone-700">Conversation date: <strong>{interactionDate}</strong></p>}
            </div>
          )}

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-indigo-700">Correct the interpretation</summary>
            <label className="mt-3 block text-sm font-medium text-stone-700">
              What kind of material is this?
              <select value={kind} onChange={(event) => {
                setKind(event.target.value as ConfirmedKind | "");
                setError(null);
              }} className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                <option value="">Not sure</option>
                {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            {kind === "conversation" && (
              <>
                <label className="mt-3 block text-sm font-medium text-stone-700">
                  Source (if you know it)
                  <select value={source} onChange={(event) => setSource(event.target.value as CaptureSource)}
                    className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                    {PASTED_CONVERSATION_SOURCES.map((item) =>
                      <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="mt-3 block text-sm font-medium text-stone-700">
                  Conversation date
                  <input type="date" value={interactionDate}
                    onChange={(event) => setInteractionDate(event.target.value)}
                    className="mt-1 block rounded-lg border border-stone-300 bg-white px-3 py-2" />
                </label>
              </>
            )}
          </details>

          <p className="mt-3 text-xs text-stone-600">
            {kind === "conversation"
              ? "Only extracted relationship context and a dated, user-pasted source label will be saved. The original pasted conversation is not retained."
              : kind === "moment"
                ? "Your original words will be saved as a private personal moment, without automatic matching or sharing."
                : kind === "note"
                  ? "Your original words will be saved as a note about this person."
                  : "Choose the type to determine how the text can be safely saved."}
          </p>
          <button type="button" onClick={save} disabled={savePending || reviewPending || !kind ||
              (kind === "conversation" && !interactionDate)}
            className="mt-3 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-60">
            {savePending ? "Saving…" : "Confirm and save"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    </section>
  );
}
