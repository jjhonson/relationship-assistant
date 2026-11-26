"use server";

import { createHash, randomUUID } from "node:crypto";
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
import { parsePastedConversation } from "@/lib/pasted-conversation";
import { reviewConnectionSubjects } from "@/lib/connection-subjects";
import {
  createDiscoveredRelationshipRecord,
  createManualRelationshipRecord,
  createRelationshipRecord,
  relationshipIntentionModes,
  replaceRelationshipIntention,
  replaceRelationshipLabels,
  type RelationshipSource,
} from "@/lib/relationship-record";
import {
  findRelationshipByIdentity,
  getRelationship,
  listConnectionJourneys,
  saveInferredConversation,
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

export async function updateRelationshipIntention(id: string, formData: FormData) {
  ensureDevelopment();
  const record = await getRelationship(id);
  if (!record) throw new Error("Relationship not found.");

  const rawMode = formData.get("intentionMode");
  const rawOutcome = formData.get("desiredOutcome");
  if (typeof rawMode !== "string" || typeof rawOutcome !== "string") {
    throw new Error("Relationship intention form is invalid.");
  }
  const mode = rawMode.trim();
  if (mode !== "" && !relationshipIntentionModes.some((value) => value === mode)) {
    throw new Error("Unknown relationship intention mode.");
  }

  const updated = replaceRelationshipIntention(
    record,
    mode === "" ? null : mode as (typeof relationshipIntentionModes)[number],
    rawOutcome,
  );
  await saveRelationship(updated);
  revalidatePath("/relationships");
  revalidatePath("/relationships/" + id);
  redirect("/relationships/" + id + "?intention=1");
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

/** Shared persistence path; callers choose their navigation after success. */
export async function learnFromPastedConversation(id: string, formData: FormData) {
  ensureDevelopment();
  const record = await getRelationship(id);
  if (!record) throw new Error("Relationship not found.");

  const { transcript, interactionDate, sourceLabel } = parsePastedConversation({
    transcript: formData.get("transcript"),
    interactionDate: formData.get("interactionDate"),
    source: formData.get("source"),
  });

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new Error("OpenAI is not configured for this local prototype.");

  const result = await inferInteractionWithOpenAI({
    personLabel: record.personLabel,
    interactionDate,
    transcript,
    sourceLabel,
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
      openLoops: record.openLoops.map(({ commitment, owner, status }) => ({
        commitment,
        owner,
        status,
      })),
      // Only explicitly confirmed labels have authority in subsequent inference.
      confirmedLabels: {
        contexts: record.labelAuthority === "user-confirmed" ? record.relationshipContexts : [],
        roles: record.labelAuthority === "user-confirmed" ? record.relationshipRoles : [],
      },
    },
  }, {
    apiKey,
    model: process.env.OPENAI_RELATIONSHIP_MODEL,
  });

  const rawRequestId = formData.get("submissionId");
  const requestId = typeof rawRequestId === "string" && rawRequestId ? rawRequestId : undefined;
  if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("Invalid private save request identifier.");
  }
  const source: RelationshipSource = {
    id: "pasted:" + (requestId ?? randomUUID()),
    source: "manual",
    observedAt: interactionDate,
    label: sourceLabel,
    ...(requestId ? { submissionDigest: createHash("sha256")
      .update(JSON.stringify({ interactionDate, sourceLabel, transcript }))
      .digest("hex") } : {}),
  };

  // A replay with this same request ID never recreates sourced memory, and
  // the merge uses the freshest committed relationship record.
  await saveInferredConversation(id, result.extraction, source, requestId);

  revalidatePath("/relationships");
  revalidatePath("/relationships/" + id);
  return { relationshipId: id };
}

/** Retain the old form's redirect, but only after its shared write completes. */
export async function addTranscriptInteraction(id: string, formData: FormData) {
  const { relationshipId } = await learnFromPastedConversation(id, formData);
  redirect("/relationships/" + relationshipId + "?updated=1");
}


/** On-demand ideas only. No raw transcripts, sent messages, or saved recommendations. */
export async function reviewRelationshipConnection(id: string) {
  ensureDevelopment();
  const record = await getRelationship(id);
  if (!record) throw new Error("Relationship not found.");

  const timeZone = process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver";
  const reviewedAt = new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const journeys = await listConnectionJourneys(id);
  return reviewConnectionSubjects(record, {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_RELATIONSHIP_MODEL,
    userLabel: process.env.RELATIONSHIP_USER_LABEL ?? "Jason",
    reviewedAt,
    excludedBasisIds: journeys.map((item) => item.basisId).filter(Boolean),
  });
}
