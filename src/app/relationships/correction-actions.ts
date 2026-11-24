"use server";

import { revalidatePath } from "next/cache";
import {
  correctSavedActionableMemory, dismissSavedConnectionSuggestion,
} from "@/lib/relationship-store";
import type { ActionableMemoryTarget, ActionableMemoryDisposition } from "@/lib/relationship-record";

function ensureDevelopment() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Memory corrections are available only in local development.");
  }
}

function revalidateRelationship(personId: string) {
  revalidatePath("/relationships/" + personId);
  revalidatePath("/relationships");
  revalidatePath("/");
}

/** Original memory remains in an audit record, but is retired from active attention. */
export async function correctRelationshipActionableMemory(
  personId: string,
  target: ActionableMemoryTarget,
  formData: FormData,
) {
  ensureDevelopment();
  const raw = formData.get("decision");
  if (raw !== "Done" && raw !== "Not relevant" && raw !== "Incorrect" && raw !== "Edit") {
    throw new Error("Choose how to correct the memory.");
  }
  const decision: ActionableMemoryDisposition = raw;
  const originalText = formData.get("replacementText");
  const originalContext = formData.get("replacementContext");
  if (decision === "Edit" && (typeof originalText !== "string" ||
      typeof originalContext !== "string")) {
    throw new Error("Provide a corrected description and context.");
  }
  await correctSavedActionableMemory(personId, target, decision, {
    text: decision === "Edit" ? String(originalText) : "",
    context: decision === "Edit" ? String(originalContext) : "",
  });
  revalidateRelationship(personId);
}

export async function dismissRelationshipConnectionIdea(personId: string, basisId: string) {
  ensureDevelopment();
  await dismissSavedConnectionSuggestion(
    personId, basisId, process.env.RELATIONSHIP_USER_LABEL ?? "Jason",
  );
  revalidateRelationship(personId);
  return { dismissed: true as const };
}
