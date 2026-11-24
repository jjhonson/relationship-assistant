"use client";

import { useState } from "react";
import { correctRelationshipActionableMemory } from "../correction-actions";
import type { ActionableMemoryTarget } from "@/lib/relationship-record";

export default function MemoryCorrectionForm({
  relationshipId, target, text, context, canMarkDone = false,
}: { relationshipId: string; target: ActionableMemoryTarget; text: string; context: string; canMarkDone?: boolean }) {
  const [decision, setDecision] = useState("");
  return (
    <details className="mt-3 border-t border-stone-200 pt-2">
      <summary className="cursor-pointer text-xs font-medium text-indigo-700">
        Correct this memory
      </summary>
      <form action={correctRelationshipActionableMemory.bind(null, relationshipId, target)}
        className="mt-3 space-y-3 rounded-lg border border-stone-200 bg-white p-3">
        <label className="block text-sm font-medium text-stone-800">
          What would you like to correct?
          <select name="decision" required value={decision} onChange={(event) => setDecision(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2">
            <option value="">Choose an action</option>
            {target.kind === "open-loop" && canMarkDone &&
              <option value="Done">I completed this commitment</option>}
            <option value="Not relevant">Not relevant to remember here</option>
            <option value="Incorrect">This memory is incorrect</option>
            <option value="Edit">Correct the details</option>
          </select>
        </label>
        {decision === "Edit" && (
          <>
            <label className="block text-sm font-medium text-stone-800">
              {target.kind === "open-loop" ? "What did you actually promise?" : "What was actually mentioned?"}
              <textarea name="replacementText" rows={2} required minLength={4} maxLength={500}
                defaultValue={text}
                className="mt-1 block w-full rounded-lg border border-stone-300 p-2" />
            </label>
            <label className="block text-sm font-medium text-stone-800">
              {target.kind === "open-loop" ? "Who made the commitment?" : "Timing or context mentioned (not a task to monitor)"}
              <input name="replacementContext" required maxLength={240} defaultValue={context}
                className="mt-1 block w-full rounded-lg border border-stone-300 p-2" />
            </label>
            <p className="text-xs text-stone-600">
              Your correction takes precedence over the older interpretation. The original source remains available.
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
