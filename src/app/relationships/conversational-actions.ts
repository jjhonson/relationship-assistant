"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRelationship, savePersonalMoment } from "@/lib/relationship-store";
import { interpretConversationalCapture, type CaptureKind, type CaptureSource } from "@/lib/conversational-capture";
import { addTranscriptInteraction } from "./actions";
import { saveQuickCapture } from "./capture-actions";

function ensureDevelopment() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Conversational capture is available only in local development.");
  }
}

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Interpret on explicit request. Does not write notes, third-party text or model results. */
export async function previewPersonCapture(relationshipId: string, text: string) {
  ensureDevelopment();
  const person = await getRelationship(relationshipId);
  if (!person) throw new Error("Relationship not found.");
  return interpretConversationalCapture({ text, personLabel: person.personLabel, currentDate: localToday() }, {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_RELATIONSHIP_MODEL,
  });
}

type ReviewedInput = {
  text: string;
  kind: Exclude<CaptureKind, "uncertain">;
  source: CaptureSource;
  interactionDate: string;
};

/** Explicit human approval picks a retention path. Pasted conversations are NEVER saved raw. */
export async function saveReviewedPersonCapture(relationshipId: string, input: ReviewedInput) {
  ensureDevelopment();
  const person = await getRelationship(relationshipId);
  if (!person) throw new Error("Relationship not found.");
  if (!input || typeof input.text !== "string" || !input.text.trim() ||
      input.text.trim().length > 80_000) {
    throw new Error("Please enter text to save.");
  }

  if (input.kind === "conversation") {
    const form = new FormData();
    form.set("source", input.source);
    form.set("interactionDate", input.interactionDate);
    form.set("transcript", input.text);
    // Existing safe inference path retains only structured memory and sourced metadata.
    return addTranscriptInteraction(relationshipId, form);
  }

  if (input.kind === "note") {
    if (input.text.trim().length > 5_000) {
      throw new Error("A personal note can contain up to 5,000 characters.");
    }
    const form = new FormData();
    form.set("note", input.text);
    // Explicitly user-authored notes preserve their wording as an intentional memory.
    return saveQuickCapture(relationshipId, form);
  }

  if (input.kind === "moment") {
    if (input.text.trim().length > 3_000) {
      throw new Error("A personal moment can contain up to 3,000 characters.");
    }
    // A personal moment is private by default, without automatic matching or outreach.
    const saved = await savePersonalMoment({ description: input.text, consideration: "private" });
    revalidatePath("/moments");
    redirect("/moments?saved=" + encodeURIComponent(saved.id));
  }
  throw new Error("Choose what kind of material to save.");
}
