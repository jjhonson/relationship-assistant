"use client";

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveHomePhotoInput, submitHomeText } from "./home/actions";
import type { HomeCaptureChoices, HomeCapturePlan } from "@/lib/home-direct-capture";
import type { HomePersonChoice } from "@/lib/home-identity";

type Clarify = Extract<HomeCapturePlan, { state: "clarify" }>;

const PROMPTS = [
  "Who did you have an interesting conversation with recently?",
  "Read anything worth remembering?",
  "What's something new you've tried or learned?",
  "Did something recently remind you of someone?",
] as const;
const kinds: Array<{ value: "conversation" | "note" | "moment"; label: string }> = [
  { value: "note", label: "My own note" },
  { value: "moment", label: "Personal thought or moment" },
  { value: "conversation", label: "Pasted conversation or transcript" },
];

/** One Save, one concrete question only if the meaning needs clarification. */
export default function HomeCapture({
  people, contextRelationshipId, compact = false,
}: {
  people: HomePersonChoice[];
  contextRelationshipId?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const contextPersonLabel = people.find((person) => person.id === contextRelationshipId)?.label ?? "";
  const [text, setText] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const [importedTextFile, setImportedTextFile] = useState(false);
  const [clarification, setClarification] = useState<Clarify | null>(null);
  const [choices, setChoices] = useState<HomeCaptureChoices>({});
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const currentPersonLabel = choices.relationshipId && choices.relationshipId !== contextRelationshipId
    ? choices.relationshipId === "__new__" ? choices.newPersonLabel?.trim() || "Someone new" :
      people.find((person) => person.id === choices.relationshipId)?.label ?? contextPersonLabel
    : contextPersonLabel;
  // Reuse this key after network uncertainty; never create another record on retry.
  const submissionRef = useRef<string | null>(null);

  function changeText(next: string) {
    setText(next);
    if (!next.trim()) setImportedTextFile(false);
    setClarification(null);
    setChoices({});
    setImportNotice("");
    setError(null);
    submissionRef.current = null;
  }

  async function importTextFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(txt|md|csv)$/i.test(file.name) || file.size > 100_000) {
      setError("Choose a .txt, .md or .csv file smaller than 100 KB.");
      return;
    }
    try {
      const imported = await file.text();
      if (!imported.trim() || imported.includes("\u0000") || imported.length + text.length + 2 > 80_000) {
        throw new Error("Invalid text input.");
      }
      changeText(text ? text + "\n\n" + imported : imported);
      setPhoto(null);
      setImportNotice("Added text from " + file.name + ". The original file was not saved.");
      setImportedTextFile(true);
    } catch {
      setError("Couldn't read that text file. Nothing was saved.");
    }
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!next) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(next.type) ||
        next.size === 0 || next.size > 4 * 1024 * 1024) {
      setError("Choose a JPEG, PNG or WebP smaller than 4 MB.");
      return;
    }
    setPhoto(next);
    setClarification(null);
    setError(null);
    setImportNotice("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (photo && text.trim().length > 1500) {
      setError("Keep the note with a photo under 1,500 characters.");
      return;
    }
    if (!photo && !text.trim()) {
      setError("Write something or choose a photo.");
      return;
    }
    if (!photo && text.trim().length > 80_000) {
      setError("This input is longer than 80,000 characters. Your full text is still here; nothing was submitted.");
      return;
    }
    if (clarification &&
        ((clarification.field === "kind" && !choices.kind) ||
         (clarification.field === "person" && (!choices.relationshipId ||
           (clarification.kind === "conversation" && choices.relationshipId === "__new__" && !choices.newPersonLabel?.trim()))) ||
         (clarification.field === "date" && !choices.interactionDate))) {
      setError("Answer the question before saving.");
      return;
    }

    setError(null);
    startSave(async () => {
      try {
        if (photo) {
          const form = new FormData();
          form.set("note", text);
          form.set("photo", photo);
          const result = await saveHomePhotoInput(form, contextRelationshipId);
          router.push(result.destination);
          return;
        }
        if (!submissionRef.current) submissionRef.current = crypto.randomUUID();
        const result = await submitHomeText({
          text, submissionId: submissionRef.current, choices, importedTextFile,
          contextRelationshipId,
        });
        if (result.state === "clarify") {
          setClarification(result);
          setChoices(result.choices);
          return;
        }
        router.push(result.destination);
      } catch {
        // The write may have committed before an error was returned. Keep the
        // same input + submission ID so retry is safe for textual captures.
        setError("Save could not be confirmed. Check the saved record before retrying.");
      }
    });
  }

  return (
    <section aria-label={currentPersonLabel ? "Remember something about " + currentPersonLabel : "Remember something"}
      className="rounded-3xl border border-stone-300 bg-white p-3 shadow-[0_8px_32px_rgba(28,25,23,0.05)] sm:p-4">
      {contextPersonLabel && (
        <p className="px-3 pt-1 text-xs font-medium text-stone-500">About {currentPersonLabel}</p>
      )}
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="home-capture-input">What do you want to remember?</label>
        <textarea
          id="home-capture-input" value={text}
          onChange={(event) => changeText(event.target.value)}
          rows={compact ? 3 : 6} disabled={saving}
          placeholder={contextPersonLabel ? "Remember a conversation or something about " + contextPersonLabel + "…" :
            PROMPTS[promptIndex]}
          className={(compact ? "min-h-24 " : "min-h-44 sm:min-h-52 ") + "w-full resize-y rounded-2xl bg-white px-3 py-3 text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400 focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-70 sm:px-4"}
        />

        {!photo && text.length > 80_000 && (
          <p role="status" className="mx-3 mb-3 text-xs text-stone-600">
            {text.length.toLocaleString()} characters; the current limit is 80,000. Your text has not been shortened.
          </p>
        )}

        {photo && (
          <div className="mx-2 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs sm:mx-3">
            <span className="font-medium text-stone-700">Photo: {photo.name}</span>
            <button type="button" onClick={() => setPhoto(null)}
              className="font-medium text-stone-500 underline-offset-4 hover:underline">Remove</button>
            <span className="text-stone-500">We save extracted observations, not the original image.</span>
          </div>
        )}
        {importNotice && <p className="mx-3 mb-3 text-xs text-stone-500" role="status">{importNotice}</p>}

        {clarification && !photo && (
          <div className="mx-2 mb-3 space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:mx-3"
            aria-live="polite">
            <p className="text-sm font-medium text-stone-900">{clarification.question}</p>
            {clarification.field === "kind" && (
              <label className="block">
                <span className="sr-only">Material type</span>
                <select value={choices.kind ?? ""} disabled={saving}
                  onChange={(event) => setChoices((previous) => ({
                    ...previous,
                    kind: event.target.value as HomeCaptureChoices["kind"],
                  }))}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
                  <option value="">Choose one</option>
                  {kinds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            )}
            {clarification.field === "person" && (
              <>
                <label className="block">
                  <span className="sr-only">Person</span>
                  <select value={choices.relationshipId ?? ""} disabled={saving}
                    onChange={(event) => setChoices((previous) => ({
                      ...previous, relationshipId: event.target.value,
                    }))}
                    className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm">
                    <option value="">Choose a person</option>
                    {people.map((person) =>
                      <option key={person.id} value={person.id}>{person.label}</option>)}
                    <option value="__new__">{clarification.kind === "conversation"
                      ? "Someone new" : "Someone new (review the new record afterward)"}</option>
                  </select>
                </label>
                {clarification.kind === "conversation" && choices.relationshipId === "__new__" && (
                  <label className="block text-sm text-stone-700">
                    Name
                    <input type="text" value={choices.newPersonLabel ?? ""} maxLength={120} disabled={saving}
                      onChange={(event) => setChoices((previous) => ({ ...previous, newPersonLabel: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      placeholder="Name of the person in this conversation" />
                  </label>
                )}
              </>
            )}
            {clarification.field === "date" && (
              <label className="block">
                <span className="sr-only">Conversation date</span>
                <input type="date" value={choices.interactionDate ?? ""} disabled={saving}
                  onChange={(event) => setChoices((previous) => ({
                    ...previous, interactionDate: event.target.value,
                  }))}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
              </label>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-2 pt-3 sm:px-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-stone-600">
            <label className="cursor-pointer rounded-lg px-1 py-1.5 hover:text-stone-950 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-stone-500">
              <input aria-label="Attach a photo" type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={choosePhoto} className="sr-only" />+ Photo
            </label>
            <label className="cursor-pointer rounded-lg px-1 py-1.5 hover:text-stone-950 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-stone-500">
              <input aria-label="Import a text file" type="file"
                accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
                onChange={importTextFile} className="sr-only" />+ Text file
            </label>
            {!contextPersonLabel && (
              <button type="button" disabled={saving || !!photo}
                onClick={() => setPromptIndex((current) => (current + 1) % PROMPTS.length)}
                className="rounded-lg py-1.5 text-stone-500 hover:text-stone-900 disabled:opacity-40">
                Another prompt
              </button>
            )}
          </div>
          <button type="submit" disabled={saving}
            className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-wait disabled:opacity-50">
            {saving ? "Saving…" : clarification ? "Continue" : "Save"}
            <span aria-hidden="true" className="ml-2">↗</span>
          </button>
        </div>
      </form>

      <div className="px-3 pb-1 pt-2 text-xs leading-relaxed text-stone-500">
        <details>
          <summary className="cursor-pointer hover:text-stone-800">Privacy &amp; sources</summary>
          <p className="mt-1 max-w-2xl">
            One Save when the meaning is clear. Otherwise we ask only what we need.
            Pasted conversations are reduced to sourced memory without saving the transcript.
            Your own notes retain their wording; personal moments stay private.
            A chosen photo is interpreted without retaining the image.
            Text files are imported locally as text. PDF and Office files are not yet supported.
            Nothing is sent to anyone automatically.
          </p>
        </details>
      </div>

      {error && (
        <p role="alert"
          className="mt-3 rounded-xl border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-800">
          {error}
        </p>
      )}
    </section>
  );
}
