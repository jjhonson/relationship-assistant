"use client";

import { useState } from "react";
import { correctRelationshipActionableMemory } from "../correction-actions";
import type { ActionableMemoryTarget } from "@/lib/relationship-record";

export default function MemoryCorrectionForm({
  relationshipId, target, text, context,
}: { relationshipId: string; target: ActionableMemoryTarget; text: string; context: string }) {
  const [decision, setDecision] = useState("");
  return (
    <details className="mt-3 border-t border-stone-200 pt-2">
      <summary className="cursor-pointer text-xs font-medium text-indigo-700">
        Correct this memory
      </summary>
      <form action={correctRelationshipActionableMemory.bind(null, relationshipId, target)}
        className="mt-3 space-y-3 rounded-lg border border-stone-200 bg-white p-3">
        <label className="block text-sm font-medium text-stone-800">
          What should happen to it?
          <select name="decision" required value={decision} onChange={(event) => setDecision(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
            <option value="">Choose an action</option>
            {target.kind === "open-loop" && <option value="Done">Done (actually completed)</option>}
            <option value="Not relevant">Not relevant, don't prompt me</option>
            <option value="Incorrect">Incorrect, this did not happen</option>
            <option value="Edit">Edit the memory</option>
          </select>
        </label>
        {decision === "Edit" && (
          <>
            <label className="block text-sm font-medium text-stone-800">
              Correct description
              <textarea name="replacementText" rows={2} required minLength={4} maxLength={500}
                defaultValue={text}
                className="mt-1 block w-full rounded-lg border border-stone-300 p-2" />
            </label>
            <label className="block text-sm font-medium text-stone-800">
              {target.kind === "open-loop" ? "Who owns the commitment?" : "What would trigger it?"}
              <input name="replacementContext" required maxLength={240} defaultValue={context}
                className="mt-1 block w-full rounded-lg border border-stone-300 p-2" />
            </label>
            <p className="text-xs text-stone-600">
              The replacement is marked user-confirmed. Old evidence stays available in the correction history.
            </p>
          </>
        )}
        {decision && decision !== "Edit" && (
          <p className="text-xs text-stone-600">
            This retires the item from active attention, but preserves its original source and the decision.
          </p>
        )}
        <button type="submit" disabled={!decision}
          className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          Save correction
        </button>
      </form>
    </details>
  );
}
