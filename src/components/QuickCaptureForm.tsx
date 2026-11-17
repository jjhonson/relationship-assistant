import { saveQuickCapture } from "@/app/relationships/capture-actions";

export default function QuickCaptureForm({
  contextRelationshipId = null,
  compact = false,
}: {
  contextRelationshipId?: string | null;
  compact?: boolean;
}) {
  const action = saveQuickCapture.bind(null, contextRelationshipId);
  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Quick capture</p>
      <h2 className="mt-1 text-xl font-semibold text-stone-900">Remember something</h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        A first meeting, a conversation, something you learned, or a small update. Just write what you remember.
        You can use your device&apos;s dictation. No contact details required.
      </p>
      <form action={action} className="mt-4 space-y-3">
        <label className="block text-sm font-medium text-stone-700" htmlFor={contextRelationshipId ? "note-person" : "note-all"}>
          Your note
        </label>
        <textarea
          id={contextRelationshipId ? "note-person" : "note-all"}
          name="note"
          required
          maxLength={5000}
          rows={compact ? 3 : 4}
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm"
          placeholder="Met our new neighbors over the back fence. Tom and Judy have two dogs named Pepper and Scout…"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800"
        >
          Save memory
        </button>
      </form>
      <p className="mt-3 text-xs text-stone-500">
        Your note is deliberately saved on this local development app, even if interpretation fails.
        When configured, the text is also sent to OpenAI for structured interpretation with provider storage disabled.
        It is not an automatically captured call transcript.
      </p>
    </section>
  );
}
