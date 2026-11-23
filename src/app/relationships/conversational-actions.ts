"use server";

import { revalidatePath } from "next/cache";
import { getRelationship, savePersonalMoment } from "@/lib/relationship-store";
import { interpretConversationalCapture, looksLikePastedConversation, type CaptureKind, type CaptureSource } from "@/lib/conversational-capture";
import { learnFromPastedConversation } from "./actions";
import { saveQuickCaptureWithoutRedirect } from "./capture-actions";

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

  // Classification may be wrong even after review. Never silently retain
  // obvious third-party transcripts as if they were original user notes.
  if (input.kind !== "conversation" && looksLikePastedConversation(input.text)) {
    throw new Error("This looks like a pasted conversation. Save it as a conversation so the full text is not retained.");
  }

  if (input.kind === "conversation") {
    const form = new FormData();
    form.set("source", input.source);
    form.set("interactionDate", input.interactionDate);
    form.set("transcript", input.text);
    // Existing safe inference path retains only structured memory and sourced metadata.
    const { relationshipId: savedId } = await learnFromPastedConversation(relationshipId, form);
    return { saved: true as const, destination: "/relationships/" + encodeURIComponent(savedId) + "?updated=1" };
  }

  if (input.kind === "note") {
    if (input.text.trim().length > 5_000) {
      throw new Error("A personal note can contain up to 5,000 characters.");
    }
    const form = new FormData();
    form.set("note", input.text);
    // Explicitly user-authored notes preserve their wording as an intentional memory.
    const { captureId } = await saveQuickCaptureWithoutRedirect(relationshipId, form);
    return { saved: true as const, destination: "/captures/" + encodeURIComponent(captureId) };
  }

  if (input.kind === "moment") {
    // PR #61 raises the limit, but this draft must also work independently on main.
    if (input.text.trim().length > 1_000) {
      throw new Error("A personal moment can contain up to 1,000 characters.");
    }
    // A personal moment is private by default, without automatic matching or outreach.
    const saved = await savePersonalMoment({ description: input.text, consideration: "private" });
    revalidatePath("/moments");
    return { saved: true as const, destination: "/moments?saved=" + encodeURIComponent(saved.id) };
  }
  throw new Error("Choose what kind of material to save.");
}
