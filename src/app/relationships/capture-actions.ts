"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { inferCaptureWithOpenAI } from "@/lib/capture-inference";
import {
  getCapture,
  getRelationship,
  saveCaptureInterpretation,
  saveCapturePersonResolution,
  saveNewCapture,
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
      note: capture.note,
      capturedAt: capture.capturedAt,
      contextPersonLabel: context?.personLabel,
    }, { apiKey, model: process.env.OPENAI_RELATIONSHIP_MODEL });
    await saveCaptureInterpretation(capture.id, extraction);
  } catch {
    // The user-authored note was already saved. Keep it pending and do not log private content.
  }
}

export async function saveQuickCapture(contextRelationshipId: string | null, formData: FormData) {
  ensureDevelopment();
  const raw = formData.get("note");
  if (typeof raw !== "string") throw new Error("Note text is required.");
  const event = await saveNewCapture(raw, contextRelationshipId);
  await interpretIfAvailable(event.id);
  revalidatePath("/relationships");
  if (contextRelationshipId) revalidatePath("/relationships/" + contextRelationshipId);
  redirect("/captures/" + event.id);
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
