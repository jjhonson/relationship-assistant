"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { previewHomeInput, saveHomeInput } from "./home/actions";
import type { CaptureInterpretation, CaptureKind, CaptureSource } from "@/lib/conversational-capture";
import type { HomePersonChoice } from "@/lib/home-identity";
import { PASTED_CONVERSATION_SOURCES } from "@/lib/pasted-conversation";

type ConfirmedKind = Exclude<CaptureKind, "uncertain">;

const kinds: Array<{ value: ConfirmedKind; label: string }> = [
  { value: "conversation", label: "Pasted conversation or transcript" },
  { value: "note", label: "My own note" },
  { value: "moment", label: "Personal moment or idea" },
];

export default function HomeCapture({ people }: { people: HomePersonChoice[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [interpretation, setInterpretation] = useState<CaptureInterpretation | null>(null);
  const [kind, setKind] = useState<ConfirmedKind | "">("");
  const [source, setSource] = useState<CaptureSource>("unspecified");
  const [interactionDate, setInteractionDate] = useState("");
  const [relationshipId, setRelationshipId] = useState("");
  const [personAmbiguous, setPersonAmbiguous] = useState(false);
  const [reviewPending, startReview] = useTransition();
  const [savePending, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const selectedPerson = people.find((person) => person.id === relationshipId);
  const needsPerson = kind === "conversation" && !relationshipId;
  const needsDate = kind === "conversation" && !!relationshipId && !interactionDate;
  const readyToSave = !!kind && !needsPerson && !needsDate && !savePending && !reviewPending;

  function changedText(next: string) {
    setText(next);
    setInterpretation(null);
    setKind("");
    setError(null);
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) {
      setError("Tell me something or paste a conversation to review.");
      return;
    }
    setError(null);
    startReview(async () => {
      try {
        const result = await previewHomeInput(text);
        setInterpretation(result.interpretation);
        setKind(result.interpretation.kind === "uncertain" ? "" : result.interpretation.kind);
        setSource(result.interpretation.source);
        setInteractionDate(result.interpretation.interactionDate);
        setRelationshipId(result.suggestedRelationshipId ?? "");
        setPersonAmbiguous(result.ambiguousPerson);
      } catch {
        setError("Couldn't interpret this input. No information has been saved.");
      }
    });
  }

  function save() {
    if (!kind || !interpretation || !readyToSave) {
      setError("Complete the missing context before saving.");
      return;
    }
    if (kind === "note" && text.trim().length > 5000) {
      setError("Your own note can contain up to 5,000 characters.");
      return;
    }
    if (kind === "moment" && text.trim().length > 3000) {
      setError("A personal moment can contain up to 3,000 characters.");
      return;
    }
    setError(null);
    startSave(async () => {
      let destination: string;
      try {
        const result = await saveHomeInput({ text, kind, source, interactionDate, relationshipId });
        destination = result.destination;
      } catch (cause) {
        // The operation may have persisted before a connectivity failure.
        // Preserve the text and encourage inspection before a second attempt.
        const message = cause instanceof Error &&
          /choose|up to \d|actual conversation date|pasted conversation/i.test(cause.message)
          ? cause.message
          : "Save could not be confirmed. Check the record before retrying.";
        setError(message);
        return;
      }
      router.push(destination);
    });
  }

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Tell the agent something</p>
      <h2 className="mt-1 text-xl font-semibold text-stone-900">What do you want to remember?</h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        Paste an email, chat or meeting transcript, describe someone, or save something from your own life.
        Start in your own words. We will ask about the source, date or person only when it matters.
      </p>
      <form onSubmit={review} className="mt-4 space-y-3">
        <label className="sr-only" htmlFor="home-capture-input">Your text or pasted conversation</label>
        <textarea id="home-capture-input" value={text} required maxLength={80000}
          onChange={(event) => changedText(event.target.value)} rows={5}
          className="w-full rounded-xl border border-stone-300 bg-white p-4 text-sm"
          placeholder={"Just finished a meeting with Tom. Here's the transcript…\n\nOr: I found an article that made me reconsider something."} />
        <button type="submit" disabled={reviewPending || savePending}
          className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50">
          {reviewPending ? "Interpreting…" : "Review what I understood"}
        </button>
      </form>
      <p className="mt-2 text-xs text-stone-500">
        Interpretation happens only when you request it. Nothing is saved until you confirm.
        Pasted third-party conversations are not retained verbatim.
      </p>

      {interpretation && (
        <div aria-live="polite" className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
          <h3 className="font-semibold text-stone-900">Here's what I understood</h3>
          {interpretation.summary && <p className="mt-2 text-sm text-stone-800">{interpretation.summary}</p>}
          <p className="mt-2 text-sm text-stone-700">
            Suggested type: <strong>{kinds.find((item) => item.value === interpretation.kind)?.label ??
              "Needs clarification"}</strong>
          </p>

          {!kind && (
            <label className="mt-3 block text-sm font-medium text-stone-800">
              Is this copied conversation material, your own note, or a personal moment?
              <select value={kind}
                onChange={(event) => { setKind(event.target.value as ConfirmedKind | ""); setError(null); }}
                className="mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                <option value="">Choose what it is</option>
                {kinds.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
          )}

          {kind === "conversation" && (
            <div className="mt-3 space-y-3 text-sm text-stone-700">
              {needsPerson ? (
                <label className="block font-medium text-stone-800">
                  {personAmbiguous ? "Several saved people may match. Which one is this about?" :
                    "Which saved person is this conversation about?"}
                  <select value={relationshipId}
                    onChange={(event) => { setRelationshipId(event.target.value); setError(null); }}
                    className="mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                    <option value="">Choose an existing person</option>
                    {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
                  </select>
                  {people.length === 0 && (
                    <span className="mt-1 block text-xs font-normal text-stone-500">
                      No people saved yet. Create a relationship in People before saving a pasted conversation.
                    </span>
                  )}
                </label>
              ) : (
                <p>Person: <strong>{selectedPerson?.label}</strong> (suggested from text or selected by you)</p>
              )}
              {needsDate && (
                <label className="block font-medium text-stone-800">
                  {interpretation.question || "When did this conversation happen?"}
                  <input type="date" value={interactionDate}
                    onChange={(event) => { setInteractionDate(event.target.value); setError(null); }}
                    className="mt-2 block rounded-lg border border-stone-300 bg-white px-3 py-2" />
                </label>
              )}
              {interactionDate && <p>Date: <strong>{interactionDate}</strong></p>}
              <p>Source: <strong>{PASTED_CONVERSATION_SOURCES.find((item) => item.value === source)?.label ??
                "Source unspecified"}</strong> (inferred, not independently verified)</p>
              <p className="text-xs text-stone-500">
                Only structured relationship memory and a source label will be saved. Other people named in the text won't be added automatically.
              </p>
            </div>
          )}
          {kind === "note" && (
            <p className="mt-3 text-sm text-stone-700">
              {selectedPerson
                ? "Your original note will be saved about " + selectedPerson.label + "."
                : "Your own note can begin a new relationship record. The resulting people will be available for review."}
            </p>
          )}
          {kind === "moment" && (
            <p className="mt-3 text-sm text-stone-700">
              This will be saved privately as something from your own life. No match or outreach happens automatically.
            </p>
          )}

          <details className="mt-4 border-t border-indigo-100 pt-3">
            <summary className="cursor-pointer text-sm font-medium text-indigo-700">Correct the interpretation</summary>
            <div className="mt-3 space-y-3 text-sm">
              <label className="block font-medium">
                What kind of material is this?
                <select value={kind} onChange={(event) => { setKind(event.target.value as ConfirmedKind | ""); setError(null); }}
                  className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                  <option value="">I'm not sure</option>
                  {kinds.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              {kind !== "moment" && (
                <label className="block font-medium">
                  Person (optional for your own note)
                  <select value={relationshipId}
                    onChange={(event) => { setRelationshipId(event.target.value); setError(null); }}
                    className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                    <option value="">No existing person selected</option>
                    {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
                  </select>
                </label>
              )}
              {kind === "conversation" && (
                <>
                  <label className="block font-medium">
                    Conversation source (if known)
                    <select value={source} onChange={(event) => setSource(event.target.value as CaptureSource)}
                      className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                      {PASTED_CONVERSATION_SOURCES.map((option) =>
                        <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block font-medium">
                    Conversation date
                    <input type="date" value={interactionDate}
                      onChange={(event) => setInteractionDate(event.target.value)}
                      className="mt-1 block rounded-lg border border-stone-300 bg-white px-3 py-2" />
                  </label>
                </>
              )}
            </div>
          </details>
          <button type="button" onClick={save} disabled={!readyToSave}
            className="mt-4 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50">
            {savePending ? "Saving…" : "Confirm and save"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    </section>
  );
}
