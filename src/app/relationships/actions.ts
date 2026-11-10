"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PilotAnalysisResult } from "@/app/real-pilot/actions";
import type {
  RelationshipContextValue,
  RelationshipRoleValue,
} from "@/lib/inference-benchmark";
import { inferInteractionWithOpenAI } from "@/lib/interaction-inference";
import {
  createManualRelationshipRecord,
  createRelationshipRecord,
  mergeInteractionIntoRelationship,
  type RelationshipSource,
} from "@/lib/relationship-record";
import { getRelationship, saveRelationship } from "@/lib/relationship-store";

type ReadyPilotAnalysis = Extract<PilotAnalysisResult, { kind: "ready" }>;

const contexts = new Set<RelationshipContextValue>([
  "Personal relationship",
  "Family",
  "Current coworker",
  "Former colleague",
  "Recruiter",
  "Service provider",
  "Professional contact",
]);

const roles = new Set<RelationshipRoleValue>([
  "Friend",
  "Mentor",
  "Mentee",
  "Advisor",
  "Sponsor",
  "Peer",
  "Collaborator",
]);

function ensureDevelopment() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Relationship persistence is only enabled in local development.");
  }
}

export async function savePilotRelationship(result: ReadyPilotAnalysis) {
  ensureDevelopment();
  const sources: RelationshipSource[] = result.evidence.map((item) => ({
    id: item.id,
    source: "gmail",
    observedAt: item.date,
    label: "Approved Gmail correspondence",
  }));

  const record = createRelationshipRecord(result.personLabel, result.inference, sources);
  await saveRelationship(record);
  revalidatePath("/relationships");
  return { ok: true as const, id: record.id };
}

export async function createManualRelationship(formData: FormData) {
  ensureDevelopment();
  const personLabel = String(formData.get("personLabel") ?? "").trim();
  if (!personLabel) throw new Error("Name is required.");

  const rawContext = String(formData.get("context") ?? "").trim();
  const rawRole = String(formData.get("role") ?? "").trim();
  const context = rawContext && contexts.has(rawContext as RelationshipContextValue)
    ? rawContext as RelationshipContextValue
    : undefined;
  const role = rawRole && roles.has(rawRole as RelationshipRoleValue)
    ? rawRole as RelationshipRoleValue
    : undefined;

  const record = createManualRelationshipRecord(personLabel, context, role);
  await saveRelationship(record);
  revalidatePath("/relationships");
  redirect("/relationships/" + record.id);
}

export async function addTranscriptInteraction(id: string, formData: FormData) {
  ensureDevelopment();
  const record = await getRelationship(id);
  if (!record) throw new Error("Relationship not found.");

  const transcript = String(formData.get("transcript") ?? "").trim();
  const interactionDate = String(formData.get("interactionDate") ?? "").trim();
  if (!transcript) throw new Error("Transcript is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(interactionDate)) {
    throw new Error("Interaction date is required.");
  }

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new Error("OpenAI is not configured for this local prototype.");

  const result = await inferInteractionWithOpenAI({
    personLabel: record.personLabel,
    interactionDate,
    transcript,
  }, {
    apiKey,
    model: process.env.OPENAI_RELATIONSHIP_MODEL,
  });

  const source: RelationshipSource = {
    id: "transcript:" + randomUUID(),
    source: "transcript",
    observedAt: interactionDate,
    label: "Call transcript",
  };

  const updated = mergeInteractionIntoRelationship(record, result.extraction, source);
  await saveRelationship(updated);

  revalidatePath("/relationships");
  revalidatePath("/relationships/" + id);
  redirect("/relationships/" + id + "?updated=1");
}
