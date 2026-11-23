"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { captureInterpretationText } from "@/lib/capture";
import { MAX_CAPTURE_IMAGE_BYTES, observeCaptureImageWithOpenAI, validateCaptureImage } from "@/lib/capture-image";
import { inferCaptureWithOpenAI } from "@/lib/capture-inference";
import {
  getCapture,
  getRelationship,
  saveCaptureInterpretation,
  saveCapturePersonResolution,
  saveConnectionDismissal,
  saveNewCapture,
  saveNewImageCapture,
  saveRelationship,
} from "@/lib/relationship-store";

function ensureDevelopment() {
  if (process.env.NODE_ENV !== "development") throw new Error("Capture is only enabled in local development.");
}

async function interpretIfAvailable(id: string) {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return;
  const capture = await getCapture(id);
  if (!capture || capture.status !== "pending") return;
  const context = capture.contextRelationshipId ? await getRelationship(capture.contextRelationshipId) : null;
  try {
    const extraction = await inferCaptureWithOpenAI({
      note: captureInterpretationText(capture),
      capturedAt: capture.capturedAt,
      contextPersonLabel: context?.personLabel,
      source: capture.source,
    }, { apiKey, model: process.env.OPENAI_RELATIONSHIP_MODEL });
    await saveCaptureInterpretation(capture.id, extraction);
  } catch {
    // The user-authored note was already saved. Keep it pending and do not log private content.
  }
}

export type CaptureFormState = { error: string | null };

export async function saveUniversalCapture(
  contextRelationshipId: string | null,
  _previous: CaptureFormState,
  formData: FormData,
): Promise<CaptureFormState> {
  ensureDevelopment();
  const rawNote = formData.get("note");
  const rawPhoto = formData.get("photo");
  if (typeof rawNote !== "string") return { error: "Write a note or choose a photo." };
  const note = rawNote.trim();
  if (note.length > 1_500 && rawPhoto instanceof File && rawPhoto.size > 0) {
    return { error: "Keep the context accompanying a photo under 1,500 characters." };
  }

  let eventId: string;
  if (rawPhoto instanceof File && rawPhoto.size > 0) {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) return { error: "Photo capture needs OpenAI configured. Nothing was saved." };
    if (rawPhoto.size > MAX_CAPTURE_IMAGE_BYTES) return { error: "Choose a photo smaller than 4 MB." };
    try {
      const bytes = new Uint8Array(await rawPhoto.arrayBuffer());
      validateCaptureImage(bytes, rawPhoto.type);
      const context = contextRelationshipId ? await getRelationship(contextRelationshipId) : null;
      const observation = await observeCaptureImageWithOpenAI({
        bytes, mimeType: rawPhoto.type, note, contextPersonLabel: context?.personLabel,
      }, { apiKey, model: process.env.OPENAI_RELATIONSHIP_MODEL });
      // The original image is not saved anywhere; only extracted text and observations remain.
      const event = await saveNewImageCapture({ note, ...observation }, contextRelationshipId);
      eventId = event.id;
    } catch (error) {
      if (error instanceof Error && (
        error.message.startsWith("Choose an image") || error.message.startsWith("Use a JPEG") ||
        error.message.startsWith("The photo did not yield"))) {
        return { error: error.message + " The image was not saved." };
      }
      return { error: "We could not interpret that photo. Nothing was saved. Try another image or a text note." };
    }
  } else {
    if (!note || note.length > 5_000) return { error: "Write a note of up to 5,000 characters or choose a photo." };
    try {
      eventId = (await saveNewCapture(note, contextRelationshipId)).id;
    } catch {
      return { error: "The note could not be saved. Please try again." };
    }
  }

  await interpretIfAvailable(eventId);
  revalidatePath("/relationships");
  if (contextRelationshipId) revalidatePath("/relationships/" + contextRelationshipId);
  redirect("/captures/" + eventId);
}

/** Save without redirect so a reviewed-input caller can confirm persistence. */
export async function saveQuickCaptureWithoutRedirect(
  contextRelationshipId: string | null, formData: FormData,
) {
  ensureDevelopment();
  const raw = formData.get("note");
  if (typeof raw !== "string") throw new Error("Note text is required.");
  const event = await saveNewCapture(raw, contextRelationshipId);
  await interpretIfAvailable(event.id);
  revalidatePath("/relationships");
  if (contextRelationshipId) revalidatePath("/relationships/" + contextRelationshipId);
  return { captureId: event.id };
}

/** Preserve the legacy quick note form behavior. */
export async function saveQuickCapture(contextRelationshipId: string | null, formData: FormData) {
  const { captureId } = await saveQuickCaptureWithoutRedirect(contextRelationshipId, formData);
  redirect("/captures/" + captureId);
}

export async function retryQuickCapture(id: string) {
  ensureDevelopment();
  await interpretIfAvailable(id);
  revalidatePath("/relationships");
  revalidatePath("/captures/" + id);
  redirect("/captures/" + id);
}

export async function linkCapturedPerson(id: string, formData: FormData) {
  ensureDevelopment();
  const rawIndex = formData.get("personIndex");
  const rawChoice = formData.get("relationshipId");
  if (typeof rawIndex !== "string" || !/^\d{1,2}$/.test(rawIndex) || typeof rawChoice !== "string") {
    throw new Error("Select a valid person to resolve.");
  }
  const updated = await saveCapturePersonResolution(id, Number(rawIndex), rawChoice);
  revalidatePath("/relationships");
  revalidatePath("/captures/" + id);
  for (const person of updated.people) {
    if (person.relationshipId) revalidatePath("/relationships/" + person.relationshipId);
  }
  redirect("/captures/" + id);
}

export async function correctRelationshipName(id: string, formData: FormData) {
  ensureDevelopment();
  const record = await getRelationship(id);
  if (!record) throw new Error("Relationship not found.");
  const rawName = formData.get("personLabel");
  if (typeof rawName !== "string" || !rawName.trim() || rawName.trim().length > 120) {
    throw new Error("Provide a name of up to 120 characters.");
  }
  await saveRelationship({
    ...record,
    personLabel: rawName.trim(),
    personLabelAuthority: "user-confirmed",
    updatedAt: new Date().toISOString(),
  });
  revalidatePath("/relationships");
  revalidatePath("/relationships/" + id);
  redirect("/relationships/" + id + "?name=1");
}

export async function dismissInferredConnection(relationshipId: string, captureId: string, connectionId: string) {
  ensureDevelopment();
  await saveConnectionDismissal(captureId, connectionId, relationshipId);
  revalidatePath("/relationships/" + relationshipId);
  revalidatePath("/captures/" + captureId);
  redirect("/relationships/" + relationshipId);
}
