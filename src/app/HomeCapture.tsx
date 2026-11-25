"use client";

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { previewHomeInput, saveHomeInput, saveHomePhotoInput } from "./home/actions";
import type { CaptureInterpretation, CaptureKind, CaptureSource } from "@/lib/conversational-capture";
import type { HomePersonChoice } from "@/lib/home-identity";
import { PASTED_CONVERSATION_SOURCES } from "@/lib/pasted-conversation";

type ConfirmedKind = Exclude<CaptureKind, "uncertain">;

const PROMPTS = [
  "Who did you have an interesting conversation with recently?",
  "Read anything worth remembering?",
  "What's something new you've tried or learned?",
  "Did something recently remind you of someone?",
] as const;

const kinds: Array<{ value: ConfirmedKind; label: string }> = [
  { value: "conversation", label: "Conversation or pasted transcript" },
  { value: "note", label: "My own note" },
  { value: "moment", label: "Personal moment or idea" },
];

export default function HomeCapture({ people }: { people: HomePersonChoice[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [importNotice, setImportNotice] = useState("");
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

  function changeText(value: string) {
    setText(value);
    setInterpretation(null);
    setKind("");
    setError(null);
  }

  async function importTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(txt|md|csv)$/i.test(file.name) || file.size > 100_000) {
      setError("Choose a .txt, .md or .csv file smaller than 100 KB. PDF and Office files are not supported here yet.");
      return;
    }
    try {
      const imported = await file.text();
      if (!imported.trim() || imported.includes("\u0000") || imported.length + text.length + 2 > 80_000) {
        throw new Error("Invalid text file.");
      }
      changeText(text ? text + "\n\n" + imported : imported);
      setPhoto(null);
      setImportNotice("Text from " + file.name + " added for review. The original file was not saved.");
    } catch {
      setError("Could not read that text file. No information was saved.");
    }
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!chosen) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(chosen.type) ||
        chosen.size === 0 || chosen.size > 4 * 1024 * 1024) {
      setError("Choose a JPEG, PNG or WebP photo smaller than 4 MB.");
      return;
    }
    setPhoto(chosen);
    setInterpretation(null);
    setKind("");
    setImportNotice("");
    setError(null);
  }

  function savePhoto() {
    if (!photo) return;
    if (text.trim().length > 1500) {
      setError("Keep the note accompanying a photo under 1,500 characters.");
      return;
    }
    setError(null);
    startSave(async () => {
      const form = new FormData();
      form.set("note", text);
      form.set("photo", photo);
      try {
        const result = await saveHomePhotoInput(form);
        router.push(result.destination);
      } catch {
        setError("Photo save could not be confirmed. Check saved captures before trying again.");
      }
    });
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (photo) {
      savePhoto();
      return;
    }
    if (!text.trim()) {
      setError("Write something or paste a conversation to review.");
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
        setError("Couldn't interpret this input. Nothing was saved; you can try again.");
      }
    });
  }

  function save() {
    if (!kind || !interpretation || !readyToSave) {
      setError("Complete the missing context before saving.");
      return;
    }
    if ((kind === "note" && text.trim().length > 5000) ||
        (kind === "moment" && text.trim().length > 3000)) {
      setError("This text is too long for that kind of memory. Edit it before saving.");
      return;
    }
    setError(null);
    startSave(async () => {
      try {
        const result = await saveHomeInput({ text, kind, source, interactionDate, relationshipId });
        router.push(result.destination);
      } catch (cause) {
        // An uncertain network response must never trigger an automatic second save.
        const message = cause instanceof Error &&
          /choose|up to \d|actual conversation date|pasted conversation/i.test(cause.message)
          ? cause.message
          : "Save could not be confirmed. Check the record before retrying.";
        setError(message);
      }
    });
  }

  return (
    <section className="rounded-3xl border border-stone-300 bg-white p-3 shadow-[0_8px_32px_rgba(28,25,23,0.05)] sm:p-4">
      <form onSubmit={review}>
        <label className="sr-only" htmlFor="home-capture-input">What do you want to remember?</label>
        <textarea
          id="home-capture-input"
          value={text}
          onChange={(event) => changeText(event.target.value)}
          rows={6}
          maxLength={80_000}
          disabled={reviewPending || savePending}
          placeholder={PROMPTS[promptIndex]}
          className="min-h-44 w-full resize-y rounded-2xl bg-white px-3 py-3 text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400 focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-70 sm:min-h-52 sm:px-4"
        />
        {photo && (
          <div className="mx-2 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs sm:mx-3">
            <span className="font-medium text-stone-700">Photo: {photo.name}</span>
            <button type="button" onClick={() => setPhoto(null)}
              className="font-medium text-stone-500 underline-offset-4 hover:underline">
              Remove
            </button>
            <span className="text-stone-500">The image is interpreted when you save; the original is not retained.</span>
          </div>
        )}
        {importNotice && <p className="mx-3 mb-3 text-xs text-stone-500" role="status">{importNotice}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-2 pt-3 sm:px-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-stone-600">
            <label className="cursor-pointer rounded-lg px-1 py-1.5 hover:text-stone-950 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-stone-500">
              <input aria-label="Attach a photo" type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={choosePhoto} className="sr-only" />
              + Photo
            </label>
            <label className="cursor-pointer rounded-lg px-1 py-1.5 hover:text-stone-950 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-stone-500">
              <input aria-label="Import a text file" type="file"
                accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
                onChange={importTextFile} className="sr-only" />
              + Text file
            </label>
            <button type="button" disabled={reviewPending || savePending || !!photo}
              onClick={() => setPromptIndex((current) => (current + 1) % PROMPTS.length)}
              className="rounded-lg py-1.5 text-stone-500 hover:text-stone-900 disabled:opacity-40">
              Another prompt
            </button>
          </div>
          <button type="submit" disabled={reviewPending || savePending}
            className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-wait disabled:opacity-50">
            {savePending ? "Saving…" : reviewPending ? "Reviewing…" :
              photo ? "Save photo memory" : "Review"}
            <span aria-hidden="true" className="ml-2">↗</span>
          </button>
        </div>
      </form>
      <div className="px-3 pb-1 pt-3 text-xs leading-relaxed text-stone-500">
        <span>Paste conversations or use device dictation. Text is reviewed before saving.</span>
        <details className="mt-1">
          <summary className="cursor-pointer hover:text-stone-800">How memory is handled</summary>
          <p className="mt-1 max-w-2xl">
            Nothing is stored until you confirm. Pasted conversations are reduced to sourced memory
            without retaining the transcript. Photo capture sends the image to the configured model
            with provider storage disabled and saves extracted observations, not the original photo.
            Text files are imported as text for review. PDF and Office files are not supported here yet.
            No one is contacted automatically.
          </p>
        </details>
      </div>

      {interpretation && !photo && (
        <div aria-live="polite" className="mt-4 space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">Before saving</h2>
            {interpretation.summary && (
              <p className="mt-1 text-sm leading-relaxed text-stone-700">{interpretation.summary}</p>
            )}
            <p className="mt-2 text-xs text-stone-500">
              Interpreted as: {kinds.find((item) => item.value === kind)?.label ?? "Needs clarification"}
            </p>
          </div>

          {!kind && (
            <label className="block text-sm text-stone-800">
              Is this a copied conversation, your own note, or a personal moment?
              <select value={kind}
                onChange={(event) => { setKind(event.target.value as ConfirmedKind | ""); setError(null); }}
                className="mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
                <option value="">Choose what it is</option>
                {kinds.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
          )}

          {kind === "conversation" && (
            <div className="space-y-3 text-sm text-stone-700">
              {needsPerson ? (
                <label className="block font-medium text-stone-800">
                  {personAmbiguous ? "Several saved people may match. Who is this about?" :
                    "Which saved person is this conversation about?"}
                  <select value={relationshipId}
                    onChange={(event) => { setRelationshipId(event.target.value); setError(null); }}
                    className="mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                    <option value="">Choose an existing person</option>
                    {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
                  </select>
                  {people.length === 0 && (
                    <span className="mt-1 block text-xs font-normal text-stone-500">
                      No people saved yet. Add a relationship on the Relationships page first.
                    </span>
                  )}
                </label>
              ) : (
                <p>Person: <strong>{selectedPerson?.label}</strong></p>
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
              <p className="text-xs">
                Source: {PASTED_CONVERSATION_SOURCES.find((item) => item.value === source)?.label ??
                  "Source unspecified"} (inferred)
              </p>
              <p className="text-xs text-stone-500">
                Only extracted context is saved. The original transcript is not retained.
              </p>
            </div>
          )}
          {kind === "note" && (
            <p className="text-sm text-stone-600">
              {selectedPerson
                ? "Your original note will be saved about " + selectedPerson.label + "."
                : "Your own note may begin a new relationship record for review."}
            </p>
          )}
          {kind === "moment" && (
            <p className="text-sm text-stone-600">
              Kept private by default. It won&apos;t automatically generate outreach.
            </p>
          )}

          <details className="border-t border-stone-200 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-stone-600 hover:text-stone-900">
              Change details
            </summary>
            <div className="mt-3 space-y-3 text-sm text-stone-700">
              <label className="block">
                Material type
                <select value={kind}
                  onChange={(event) => { setKind(event.target.value as ConfirmedKind | ""); setError(null); }}
                  className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                  <option value="">Not sure</option>
                  {kinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {kind !== "moment" && (
                <label className="block">
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
                  <label className="block">
                    Conversation source (if known)
                    <select value={source} onChange={(event) => setSource(event.target.value as CaptureSource)}
                      className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
                      {PASTED_CONVERSATION_SOURCES.map((option) =>
                        <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    Conversation date
                    <input type="date" value={interactionDate}
                      onChange={(event) => setInteractionDate(event.target.value)}
                      className="mt-1 block rounded-lg border border-stone-300 bg-white px-3 py-2" />
                  </label>
                </>
              )}
            </div>
          </details>
          <div className="flex justify-end border-t border-stone-200 pt-3">
            <button type="button" disabled={!readyToSave} onClick={save}
              className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40">
              {savePending ? "Saving…" : "Confirm and save"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-800">
          {error}
        </p>
      )}
    </section>
  );
}
