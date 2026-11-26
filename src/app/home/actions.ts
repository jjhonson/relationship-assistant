"use server";

import { revalidatePath } from "next/cache";
import { interpretConversationalCapture, looksLikePastedConversation, type CaptureKind, type CaptureSource } from "@/lib/conversational-capture";
import { suggestHomePerson } from "@/lib/home-identity";
import { planHomeCapture, type HomeCaptureChoices } from "@/lib/home-direct-capture";
import { listRelationships, savePersonalMoment } from "@/lib/relationship-store";
import { saveReviewedPersonCapture } from "@/app/relationships/conversational-actions";
import { saveQuickCaptureWithoutRedirect, saveUniversalCaptureWithoutRedirect } from "@/app/relationships/capture-actions";

function requireDevelopment() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Home capture is available only in local development.");
  }
}
function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Explicit user-requested interpretation. No database mutation or automatic AI scan on load. */
export async function previewHomeInput(text: string) {
  requireDevelopment();
  if (typeof text !== "string" || !text.trim() || text.trim().length > 80_000) {
    throw new Error("Enter up to 80,000 characters to review.");
  }
  const people = await listRelationships();
  const personHint = suggestHomePerson(
    text, people.map((person) => ({ id: person.id, label: person.personLabel })),
  );
  // Deliberately do not send the entire private address book to the model.
  const interpretation = await interpretConversationalCapture({
    text, personLabel: "No existing person selected", currentDate: localToday(),
  }, {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_RELATIONSHIP_MODEL,
  });
  return { interpretation, suggestedRelationshipId: personHint.id, ambiguousPerson: personHint.ambiguous };
}

export type ReviewedHomeInput = {
  text: string;
  kind: Exclude<CaptureKind, "uncertain">;
  source: CaptureSource;
  interactionDate: string;
  relationshipId: string;
  submissionId?: string;
};

/** A confirmed input uses one existing retention path, never an automatic relationship merge. */
export async function saveHomeInput(input: ReviewedHomeInput) {
  requireDevelopment();
  if (!input || typeof input.text !== "string" || !input.text.trim() ||
      input.text.trim().length > 80_000) {
    throw new Error("Please enter text to save.");
  }
  if (!["conversation", "note", "moment"].includes(input.kind)) {
    throw new Error("Choose what kind of material to save.");
  }
  if (input.kind !== "conversation" && looksLikePastedConversation(input.text)) {
    throw new Error("This looks like a pasted conversation. Review it as a conversation so the full transcript is not retained.");
  }

  if (input.kind === "moment") {
    if (input.text.trim().length > 3_000) throw new Error("A moment can contain up to 3,000 characters.");
    const saved = await savePersonalMoment({
      description: input.text, consideration: "private", requestId: input.submissionId,
    });
    revalidatePath("/");
    revalidatePath("/moments");
    return { saved: true as const, destination: "/moments?saved=" + encodeURIComponent(saved.id) };
  }
  if (input.kind === "conversation") {
    if (!input.relationshipId) throw new Error("Choose an existing person for this conversation.");
    if (!input.interactionDate || input.interactionDate > localToday()) {
      throw new Error("Provide the actual conversation date before saving.");
    }
  }
  if (input.kind === "note" && !input.relationshipId) {
    // Only user-authored notes use the older global person-discovery path.
    // This may suggest a new identity, subject to the existing review rules.
    if (input.text.trim().length > 5_000) throw new Error("A note can contain up to 5,000 characters.");
    const form = new FormData();
    form.set("note", input.text);
    if (input.submissionId) form.set("submissionId", input.submissionId);
    if (input.interactionDate) form.set("reportedInteractionAt", input.interactionDate);
    const { captureId } = await saveQuickCaptureWithoutRedirect(null, form);
    revalidatePath("/");
    return { saved: true as const, destination: "/captures/" + encodeURIComponent(captureId) };
  }
  if (!input.relationshipId) throw new Error("Choose an existing relationship.");
  const result = await saveReviewedPersonCapture(input.relationshipId, {
    text: input.text,
    kind: input.kind,
    source: input.source,
    interactionDate: input.interactionDate,
    submissionId: input.submissionId,
  });
  revalidatePath("/");
  return result;
}

/** Same one-input Home, existing photo pipeline; nothing is stored until the user clicks Save. */
export async function saveHomePhotoInput(formData: FormData) {
  requireDevelopment();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a photo to save.");
  }
  const result = await saveUniversalCaptureWithoutRedirect(null, formData);
  if (result.error || !result.captureId) {
    throw new Error(result.error ?? "Photo save could not be confirmed.");
  }
  revalidatePath("/");
  return { destination: "/captures/" + encodeURIComponent(result.captureId) };
}

/**
 * One explicit Save request. Model classification is interpretation only;
 * writes use the same established, source-aware retention paths. On uncertainty
 * we return one narrow question and do not mutate any store.
 */
export async function submitHomeText(input: {
  text: string;
  submissionId: string;
  choices?: HomeCaptureChoices;
  importedTextFile?: boolean;
}) {
  requireDevelopment();
  if (!input || typeof input.text !== "string" || !input.text.trim() ||
      input.text.trim().length > 80_000 ||
      typeof input.submissionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.submissionId)) {
    throw new Error("Invalid private save request.");
  }
  const today = localToday();
  const known = await listRelationships();
  // Do not send the contact list to the model; resolve names locally.
  const interpretation = await interpretConversationalCapture({
    text: input.text, personLabel: "No existing person selected", currentDate: today,
  }, {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_RELATIONSHIP_MODEL,
  });
  const plan = planHomeCapture({
    text: input.text,
    interpretation,
    people: known.map((person) => ({ id: person.id, label: person.personLabel })),
    today,
    choices: input.choices,
    importedTextFile: input.importedTextFile === true,
  });
  if (plan.state === "clarify") return plan;
  const saved = await saveHomeInput({
    text: input.text,
    kind: plan.kind,
    source: plan.source,
    relationshipId: plan.relationshipId,
    interactionDate: plan.interactionDate,
    submissionId: input.submissionId,
  });
  return { state: "saved" as const, destination: saved.destination };
}
