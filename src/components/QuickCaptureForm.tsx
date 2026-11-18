"use client";

import { useActionState } from "react";
import { saveUniversalCapture } from "@/app/relationships/capture-actions";

export default function QuickCaptureForm({
  contextRelationshipId = null,
  compact = false,
}: {
  contextRelationshipId?: string | null;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveUniversalCapture.bind(null, contextRelationshipId), { error: null },
  );
  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Quick capture</p>
      <h2 className="mt-1 text-xl font-semibold text-stone-900">Remember something</h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        Write what you remember or choose a photo of a card, note, or other memento. Tell us who it&apos;s about if the photo alone isn&apos;t clear.
        You can use dictation. No contact details required.
      </p>
      <form action={action} className="mt-4 space-y-3">
        <label className="block text-sm font-medium text-stone-700" htmlFor={contextRelationshipId ? "note-person" : "note-all"}>
          Your note or context (optional with a photo)
        </label>
        <textarea
          id={contextRelationshipId ? "note-person" : "note-all"}
          name="note"
          maxLength={5000}
          rows={compact ? 3 : 4}
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm"
          placeholder="Met our new neighbors Tom and Judy… or: Holiday card from Arvin, an old friend."
        />
        <div>
          <label className="block text-sm font-medium text-stone-700" htmlFor={contextRelationshipId ? "photo-person" : "photo-all"}>
            Choose a photo (optional)
          </label>
          <input
            id={contextRelationshipId ? "photo-person" : "photo-all"}
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-2 block w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-100 file:px-3 file:py-2 file:font-medium file:text-indigo-900"
          />
          <p className="mt-1 text-xs text-stone-500">JPEG, PNG, or WebP, up to 4 MB. On supported devices you can take a picture.</p>
        </div>
        {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800 disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Saving memory…" : "Save memory"}
        </button>
      </form>
      <p className="mt-3 text-xs text-stone-500">
        Text notes are saved locally even if interpretation fails. A selected photo is sent to OpenAI for reading and interpretation
        with provider storage disabled. We save the extracted text and observations locally, not the image itself.
        If reading fails, the image is not saved. Nothing is captured automatically.
      </p>
    </section>
  );
}
