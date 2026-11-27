"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveHomePhotoInput, submitHomeText } from "./home/actions";
import type { HomeCaptureChoices, HomeCapturePlan } from "@/lib/home-direct-capture";
import type { HomePersonChoice } from "@/lib/home-identity";
import { captureAttachmentAccept, classifyCaptureAttachment, clipboardPhoto, hasFileDrag, droppedCaptureFile } from "@/lib/capture-attachment";
import type { PersonEntryAnswer } from "@/lib/relationship-entry";
import { shouldSubmitComposerKey } from "@/lib/composer-keyboard";

type Clarify = Extract<HomeCapturePlan, { state: "clarify" }>;

/** Preview only the selected local file. Release its temporary URL on removal,
 * replacement or navigation; no network request or persistent browser storage. */
function AttachmentThumbnail({file}: {file:File}) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url=URL.createObjectURL(file);
    if(image.current) image.current.src=url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt="Attached image preview" className="size-16 shrink-0 rounded-lg border border-stone-200 bg-white object-contain" />;
}

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
  people, contextRelationshipId, compact = false, captureAvailable = true, questionAvailable = false, onDraftChange,
}: {
  people: HomePersonChoice[];
  contextRelationshipId?: string;
  compact?: boolean;
  captureAvailable?: boolean;
  questionAvailable?: boolean;
  onDraftChange?: (active: boolean) => void;
}) {
  const router = useRouter();
  const contextPersonLabel = people.find((person) => person.id === contextRelationshipId)?.label ?? "";
  const [text, setText] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const [importedTextFile, setImportedTextFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const dragDepth = useRef(0);
  const [clarification, setClarification] = useState<Clarify | null>(null);
  const [choices, setChoices] = useState<HomeCaptureChoices>({});
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<{question:string; result:PersonEntryAnswer} | null>(null);
  const currentPersonLabel = choices.relationshipId && choices.relationshipId !== contextRelationshipId
    ? choices.relationshipId === "__new__" ? choices.newPersonLabel?.trim() || "Someone new" :
      people.find((person) => person.id === choices.relationshipId)?.label ?? contextPersonLabel
    : contextPersonLabel;
  // Reuse this key after network uncertainty; never create another record on retry.
  const submissionRef = useRef<string | null>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const canSubmit = captureAvailable || (!!contextRelationshipId && questionAvailable && !photo);

  function changeText(next: string) {
    setText(next);
    onDraftChange?.(next.length > 0 || !!photo);
    if (!next.trim()) setImportedTextFile(false);
    setClarification(null);
    setChoices({});
    setImportNotice("");
    setError(null);
    submissionRef.current = null;
  }

  function attachPhoto(file: File) {
    setPhoto(file);
    onDraftChange?.(true);
    setClarification(null);
    setChoices({});
    setError(null);
    setImportNotice("");
    setReply(null);
    submissionRef.current = null;
  }

  function pasteAttachment(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted=clipboardPhoto(event.clipboardData);
    if (pasted.kind === "none") return; // Ordinary text paste is unchanged.
    event.preventDefault();
    if (saving || importing) return;
    if (pasted.kind === "unsupported") {
      setError(pasted.message);
      return;
    }
    void acceptAttachment(pasted.file);
  }

  function enterDropArea(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingFile(true);
  }

  function overDropArea(event: DragEvent<HTMLElement>) {
    if (!hasFileDrag(event.dataTransfer)) return;
    // Prevent the browser from navigating to or inserting a file path.
    event.preventDefault();
    event.dataTransfer.dropEffect = saving || importing || photo ? "none" : "copy";
    setDraggingFile(true);
  }

  function leaveDropArea() {
    if (dragDepth.current > 0) dragDepth.current -= 1;
    if (dragDepth.current === 0) setDraggingFile(false);
  }

  function dropAttachment(event: DragEvent<HTMLElement>) {
    dragDepth.current = 0;
    setDraggingFile(false);
    const dropped = droppedCaptureFile(event.dataTransfer);
    if (dropped.kind === "none") return; // Ordinary dragged text is unchanged.
    event.preventDefault();
    event.stopPropagation();
    if (saving || importing) return;
    if (dropped.kind === "unsupported") {
      setError(dropped.message);
      return;
    }
    void acceptAttachment(dropped.file);
  }

  function chooseAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void acceptAttachment(file);
  }

  async function acceptAttachment(file: File) {
    if (saving || importing) return;
    if (photo) {
      setError("Remove the existing image before adding another attachment.");
      return;
    }
    const choice = classifyCaptureAttachment(file);
    if (choice.kind === "unsupported") {
      setError(choice.message);
      return;
    }
    if (choice.kind === "photo") {
      attachPhoto(file);
      return;
    }
    // Hold the original scope while an asynchronous file read is in flight,
    // including when navigating with an otherwise empty draft.
    setImporting(true);
    onDraftChange?.(true);
    try {
      const imported = await file.text();
      if (!imported.trim() || imported.includes("\u0000") || imported.length + text.length + 2 > 80_000) {
        throw new Error("Invalid text input.");
      }
      changeText(text ? text + "\n\n" + imported : imported);
      setPhoto(null);
      setImportNotice("Added text from " + file.name);
      setImportedTextFile(true);
    } catch {
      setError("Couldn't read that text file. Nothing was saved.");
      onDraftChange?.(text.length > 0 || !!photo);
    } finally {
      setImporting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || importing || !canSubmit) return;
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
    setReply(null);
    function finish(destination: string) {
      setText(""); setPhoto(null); setClarification(null); setChoices({});
      setImportedTextFile(false); setImportNotice(""); submissionRef.current = null;
      onDraftChange?.(false);
      router.push(destination);
      router.refresh();
    }
    startSave(async () => {
      try {
        if (photo) {
          const form = new FormData();
          form.set("note", text);
          form.set("photo", photo);
          const result = await saveHomePhotoInput(form, contextRelationshipId);
          finish(result.destination);
          return;
        }
        if (!submissionRef.current) submissionRef.current = crypto.randomUUID();
        const result = await submitHomeText({
          text, submissionId: submissionRef.current, choices, importedTextFile,
          contextRelationshipId,
        });
        if (result.state === "answer") {
          setReply({question:text, result});
          setClarification(null); setChoices({});
          if (!result.retainInput) {
            setText(""); setImportNotice(""); setImportedTextFile(false); submissionRef.current=null;
            onDraftChange?.(false);
          }
          return;
        }
        if (result.state === "clarify") {
          setClarification(result);
          setChoices(result.choices);
          return;
        }
        finish(result.destination);
      } catch {
        // The write may have committed before an error was returned. Keep the
        // same input + submission ID so retry is safe for textual captures.
        setError(contextRelationshipId ? "The request could not be confirmed. Your input is still here; check the record before retrying." : "Save could not be confirmed. Check the saved record before retrying.");
      }
    });
  }

  return (
    <section aria-label={currentPersonLabel ? "Remember something about " + currentPersonLabel : "Remember something"}
      onDragEnter={enterDropArea} onDragOver={overDropArea} onDragLeave={leaveDropArea} onDrop={dropAttachment}
      className={"relative rounded-3xl border bg-white p-3 shadow-[0_8px_32px_rgba(28,25,23,0.05)] sm:p-4 " +
        (draggingFile ? "border-stone-500 ring-2 ring-stone-300" : "border-stone-300")}>
      {draggingFile && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-white/85 p-4 text-center">
          <span className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-700 shadow-sm">
            {saving || importing ? "Finish the current request first" : photo ? "Remove the attached image first" : "Drop an image or text file"}
          </span>
        </div>
      )}
      {contextPersonLabel && (
        <p className="px-3 pt-1 text-xs font-medium text-stone-500">About {currentPersonLabel}</p>
      )}
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="home-capture-input">What do you want to remember?</label>
        <textarea
          id="home-capture-input" value={text}
          onChange={(event) => changeText(event.target.value)}
          onPaste={pasteAttachment}
          onKeyDown={(event) => {
            if (!shouldSubmitComposerKey({key:event.key,shiftKey:event.shiftKey,isComposing:event.nativeEvent.isComposing,keyCode:event.nativeEvent.keyCode})) return;
            event.preventDefault();
            if (!saving && !importing && canSubmit && (text.trim() || photo)) event.currentTarget.form?.requestSubmit();
          }}
          rows={compact ? 3 : 6} disabled={saving || importing}
          placeholder={contextPersonLabel ? "Ask or add something about " + contextPersonLabel + "…" :
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
            <AttachmentThumbnail file={photo} />
            <span className="min-w-0 break-all font-medium text-stone-700">Image: {photo.name || "Clipboard image"}</span>
            <button type="button" disabled={saving || importing} onClick={() => { setPhoto(null); setError(null); onDraftChange?.(text.length > 0); }}
              className="font-medium text-stone-500 underline-offset-4 hover:underline">Remove</button>
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
            <input ref={attachmentRef} type="file" accept={captureAttachmentAccept}
              onChange={chooseAttachment} disabled={saving || importing} className="hidden" />
            <button type="button" disabled={saving || importing}
              aria-label="Attach a photo or text file"
              title="Attach or drop a photo or text file, or paste an image (JPEG, PNG, WebP, TXT, MD, CSV)"
              onClick={() => attachmentRef.current?.click()}
              className="flex size-8 items-center justify-center rounded-full border border-stone-200 text-lg leading-none text-stone-600 hover:border-stone-400 hover:text-stone-900 disabled:opacity-40">
              <span aria-hidden="true">+</span>
            </button>
            {!contextPersonLabel && (
              <button type="button" disabled={saving || importing || !!photo}
                onClick={() => setPromptIndex((current) => (current + 1) % PROMPTS.length)}
                className="rounded-lg py-1.5 text-stone-500 hover:text-stone-900 disabled:opacity-40">
                Another prompt
              </button>
            )}
          </div>
          <button type="submit" disabled={saving || importing || !canSubmit}
            aria-label={contextRelationshipId ? clarification ? "Continue" : "Submit relationship request" : clarification ? "Continue" : "Save memory"}
            title={!canSubmit ? "This request is unavailable in the current environment" : undefined}
            aria-describedby={!canSubmit ? "capture-unavailable" : undefined}
            className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-wait disabled:opacity-50">
            {importing ? "Reading…" : saving ? (contextRelationshipId ? "Working…" : "Saving…") : clarification ? "Continue" : contextRelationshipId ? null : "Save"}
            {contextRelationshipId && !saving && !importing && !clarification
              ? <span aria-hidden="true" className="text-lg leading-none">↑</span>
              : <span aria-hidden="true" className="ml-2">↗</span>}
          </button>
        </div>
      </form>

      {!canSubmit && <p id="capture-unavailable" className="sr-only">This request is unavailable in the current environment.</p>}
      {reply && <div aria-live="polite" className="mt-3 space-y-2 border-t border-stone-100 px-3 pt-3 text-sm">
        <div className="flex items-start justify-between gap-2"><p className="font-medium text-stone-800">{reply.question}</p><button type="button" onClick={() => setReply(null)} aria-label="Close answer" className="text-stone-500 hover:text-stone-900">×</button></div>
        <p className="whitespace-pre-line leading-relaxed text-stone-900">{reply.result.message}</p>
        {reply.result.note && <p className="whitespace-pre-line text-xs leading-relaxed text-stone-600">{reply.result.note}</p>}
        {reply.result.evidence.length > 0 && (
          <details className="text-xs text-stone-500">
            <summary className="cursor-pointer font-medium hover:text-stone-800">Supporting memories ({reply.result.evidence.length})</summary>
            <ul className="mt-2 space-y-2">{reply.result.evidence.map(item => (
              <li key={item.id} className="rounded-lg bg-stone-50 p-3">
                <p className="text-sm font-medium text-stone-800">{item.label}: <span className="font-normal">{item.value}</span></p>
                <p className="mt-1">Recorded {item.observedAt}{item.status ? " · " + item.status : ""}</p>
                <ul className="mt-1 space-y-1">{item.sources.map((source,i)=><li key={i}>{source.label} · {source.observedAt}</li>)}</ul>
              </li>
            ))}</ul>
          </details>
        )}
        {reply.result.offline && <p className="text-xs text-stone-500">Fictional preview · offline topic matching</p>}
      </div>}
      {error && (
        <p role="alert"
          className="mt-3 rounded-xl border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-800">
          {error}
        </p>
      )}
    </section>
  );
}
