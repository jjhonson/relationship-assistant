"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PilotAnalysisResult } from "@/app/real-pilot/actions";
import type {
  RelationshipContextValue,
  RelationshipRoleValue,
} from "@/lib/inference-benchmark";
import type { DiscoveryCandidate } from "@/lib/gmail/discovery";
import { isLookupAddress } from "@/lib/gmail/messages";
import {
  removeDiscoveryExclusion,
  saveDiscoveryExclusion,
  type DiscoveryExclusionReason,
} from "@/lib/discovery-preferences";
import { inferInteractionWithOpenAI } from "@/lib/interaction-inference";
import {
  createDiscoveredRelationshipRecord,
  createManualRelationshipRecord,
  createRelationshipRecord,
  mergeInteractionIntoRelationship,
  replaceRelationshipLabels,
  type RelationshipSource,
} from "@/lib/relationship-record";
import {
  findRelationshipByIdentity,
  getRelationship,
  saveRelationship,
} from "@/lib/relationship-store";

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

const exclusionReasons = new Set<DiscoveryExclusionReason>([
  "self",
  "close-family",
  "not-person",
  "out-of-scope",
]);

export async function excludeDiscoveredIdentity(
  address: string,
  reason: DiscoveryExclusionReason,
) {
  ensureDevelopment();
  const normalized = String(address ?? "").trim().toLowerCase();
  if (!isLookupAddress(normalized) || !exclusionReasons.has(reason)) {
    throw new Error("Discovery exclusion is invalid.");
  }
  await saveDiscoveryExclusion(normalized, reason);
  revalidatePath("/discover");
  return { ok: true as const };
}

export async function restoreDiscoveredIdentity(address: string) {
  ensureDevelopment();
  const normalized = String(address ?? "").trim().toLowerCase();
  if (!isLookupAddress(normalized)) throw new Error("Discovery identity is invalid.");
  await removeDiscoveryExclusion(normalized);
  revalidatePath("/discover");
  return { ok: true as const };
}

export async function saveDiscoveredRelationship(
  candidate: DiscoveryCandidate,
  selectedContexts: string[],
  selectedRoles: string[],
) {
  ensureDevelopment();

  const personLabel = String(candidate.name ?? "").trim();
  const address = String(candidate.address ?? "").trim().toLowerCase();
  if (!personLabel || !isLookupAddress(address)) {
    throw new Error("Discovery candidate is invalid.");
  }

  const contextValues = selectedContexts
    .filter((value): value is RelationshipContextValue =>
      contexts.has(value as RelationshipContextValue),
    );
  const roleValues = selectedRoles
    .filter((value): value is RelationshipRoleValue =>
      roles.has(value as RelationshipRoleValue),
    );

  const existing = await findRelationshipByIdentity("gmail", "email", address);
  if (existing) {
    return { ok: true as const, id: existing.id, existing: true as const };
  }

  const record = createDiscoveredRelationshipRecord(
    {
      personLabel,
      identity: {
        kind: "email",
        value: address,
        source: "gmail",
        label: personLabel,
      },
      lastObservedAt: /^\d{4}-\d{2}-\d{2}$/.test(candidate.lastExchange ?? "")
        ? candidate.lastExchange
        : null,
      uncertainty: [
        "Possible",
        "Two-way exchange observed",
        "Repeated correspondence observed",
      ].includes(candidate.uncertainty)
        ? candidate.uncertainty
        : "Possible",
      evidenceSummary: Array.isArray(candidate.reasons)
        ? candidate.reasons.slice(0, 4).map((reason) => String(reason).slice(0, 500))
        : [],
    },
    contextValues,
    roleValues,
  );

  await saveRelationship(record);
  revalidatePath("/relationships");
  revalidatePath("/discover");
  return { ok: true as const, id: record.id, existing: false as const };
}

export async function updateRelationshipLabels(id: string, formData: FormData) {
  ensureDevelopment();
  const record = await getRelationship(id);
  if (!record) throw new Error("Relationship not found.");

  const contextValues = formData.getAll("context")
    .map((value) => String(value))
    .filter((value): value is RelationshipContextValue =>
      contexts.has(value as RelationshipContextValue),
    );
  const roleValues = formData.getAll("role")
    .map((value) => String(value))
    .filter((value): value is RelationshipRoleValue =>
      roles.has(value as RelationshipRoleValue),
    );

  const updated = replaceRelationshipLabels(record, contextValues, roleValues);
  await saveRelationship(updated);
  revalidatePath("/relationships");
  revalidatePath("/relationships/" + id);
  redirect("/relationships/" + id + "?labels=1");
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
    currentMemory: {
      durableFacts: record.durableFacts.map(({ id, category, label, value }) => ({
        id,
        category,
        label,
        value,
      })),
      activeThreads: record.activeThreads.map(({ id, topic, state }) => ({
        id,
        topic,
        state,
      })),
    },
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
