import { randomUUID } from "node:crypto";
import type {
  RelationshipContextValue,
  RelationshipInference,
  RelationshipRoleValue,
} from "./inference-benchmark";

export type RelationshipSource = {
  id: string;
  source: "gmail" | "transcript" | "manual";
  observedAt: string;
  label: string;
};

export type DurableRelationshipFact = {
  id: string;
  category: "Family" | "Location" | "Interest" | "Work" | "Personal" | "Other";
  label: string;
  value: string;
  sourceIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
};

export type ActiveRelationshipThread = {
  id: string;
  topic: string;
  state: string;
  whyItMatters: string;
  nextChangeSignal: string;
  sourceIds: string[];
  lastObservedAt: string;
};

export type StewardshipOpportunity = {
  id: string;
  reason: string;
  trigger: string;
  sourceIds: string[];
  observedAt: string;
};

export type RelationshipRecord = {
  id: string;
  personLabel: string;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string | null;
  classification: RelationshipInference["classification"]["value"];
  relationshipContexts: RelationshipContextValue[];
  relationshipRoles: RelationshipRoleValue[];
  disposition: RelationshipInference["disposition"]["value"];
  currentState: RelationshipInference["currentState"]["value"];
  tags: string[];
  history: RelationshipInference["history"];
  openLoops: Array<{
    commitment: string;
    owner: string;
    status: "Open" | "Overdue" | "Unclear";
    sourceIds: string[];
  }>;
  reasonsToEngage: Array<{
    reason: string;
    sourceIds: string[];
  }>;
  unknowns: string[];
  confidence: RelationshipInference["confidence"];
  durableFacts: DurableRelationshipFact[];
  activeThreads: ActiveRelationshipThread[];
  stewardshipOpportunities: StewardshipOpportunity[];
  sources: RelationshipSource[];
};

export type InteractionExtraction = {
  summary: string;
  relationshipContexts: RelationshipContextValue[];
  relationshipRoles: RelationshipRoleValue[];
  tags: string[];
  durableFacts: Array<{
    category: DurableRelationshipFact["category"];
    label: string;
    value: string;
  }>;
  activeThreads: Array<{
    topic: string;
    state: string;
    whyItMatters: string;
    nextChangeSignal: string;
  }>;
  openLoops: Array<{
    commitment: string;
    owner: string;
    status: "Open" | "Overdue" | "Unclear";
  }>;
  stewardshipOpportunities: Array<{
    reason: string;
    trigger: string;
  }>;
  unknowns: string[];
};

export function createRelationshipRecord(
  personLabel: string,
  inference: RelationshipInference,
  sources: RelationshipSource[],
  now = new Date(),
): RelationshipRecord {
  const timestamp = now.toISOString();
  return {
    id: randomUUID(),
    personLabel: personLabel.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastInteractionAt: inference.history.latestObservedMeaningfulInteraction || null,
    classification: inference.classification.value,
    relationshipContexts: unique(inference.relationshipContexts.map((item) => item.value)),
    relationshipRoles: unique(inference.relationshipRoles.map((item) => item.value)),
    disposition: inference.disposition.value,
    currentState: inference.currentState.value,
    tags: unique(inference.tags.map((tag) => tag.label)),
    history: inference.history,
    openLoops: inference.openLoops.map((loop) => ({
      commitment: loop.commitment,
      owner: loop.owner,
      status: loop.status,
      sourceIds: loop.evidenceIds,
    })),
    reasonsToEngage: inference.reasonsToEngage.map((reason) => ({
      reason: reason.reason,
      sourceIds: reason.evidenceIds,
    })),
    unknowns: inference.unknowns,
    confidence: inference.confidence,
    durableFacts: [],
    activeThreads: [],
    stewardshipOpportunities: [],
    sources,
  };
}

export function createManualRelationshipRecord(
  personLabel: string,
  context?: RelationshipContextValue,
  role?: RelationshipRoleValue,
  now = new Date(),
): RelationshipRecord {
  const timestamp = now.toISOString();
  return {
    id: randomUUID(),
    personLabel: personLabel.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastInteractionAt: null,
    classification: context === "Family" || context === "Personal relationship"
      ? "Friend or family"
      : context === "Recruiter"
        ? "Recruiter"
        : context === "Current coworker"
          ? "Coworker"
          : context === "Service provider"
            ? "Service provider"
            : context
              ? "Professional contact"
              : "Unknown",
    relationshipContexts: context ? [context] : [],
    relationshipRoles: role ? [role] : [],
    disposition: "Relationship worth managing",
    currentState: "Unclear",
    tags: [],
    history: {
      earliestObservedMeaningfulInteraction: "",
      latestObservedMeaningfulInteraction: "",
      pattern: "Created manually; historical relationship evidence has not been reconstructed yet.",
      evidenceIds: [],
    },
    openLoops: [],
    reasonsToEngage: [],
    unknowns: ["Historical relationship evidence has not been reconstructed yet."],
    confidence: "Low",
    durableFacts: [],
    activeThreads: [],
    stewardshipOpportunities: [],
    sources: [{
      id: "manual:" + randomUUID(),
      source: "manual",
      observedAt: timestamp.slice(0, 10),
      label: "User-confirmed relationship",
    }],
  };
}

export function mergeInteractionIntoRelationship(
  record: RelationshipRecord,
  extraction: InteractionExtraction,
  source: RelationshipSource,
  now = new Date(),
): RelationshipRecord {
  return {
    ...record,
    updatedAt: now.toISOString(),
    lastInteractionAt: maxDate(record.lastInteractionAt, source.observedAt),
    relationshipContexts: unique([...record.relationshipContexts, ...extraction.relationshipContexts]),
    relationshipRoles: unique([...record.relationshipRoles, ...extraction.relationshipRoles]),
    tags: unique([...record.tags, ...extraction.tags]),
    currentState: "Active",
    openLoops: mergeByKey(
      record.openLoops,
      extraction.openLoops.map((item) => ({ ...item, sourceIds: [source.id] })),
      (item) => normalize(item.commitment) + "|" + normalize(item.owner),
    ),
    unknowns: unique([...record.unknowns, ...extraction.unknowns]),
    durableFacts: mergeFacts(record.durableFacts, extraction.durableFacts, source),
    activeThreads: mergeThreads(record.activeThreads, extraction.activeThreads, source),
    stewardshipOpportunities: mergeByKey(
      record.stewardshipOpportunities,
      extraction.stewardshipOpportunities.map((item) => ({
        id: randomUUID(),
        ...item,
        sourceIds: [source.id],
        observedAt: source.observedAt,
      })),
      (item) => normalize(item.reason) + "|" + normalize(item.trigger),
    ),
    sources: mergeByKey(record.sources, [source], (item) => item.id),
  };
}

function mergeFacts(
  existing: DurableRelationshipFact[],
  incoming: InteractionExtraction["durableFacts"],
  source: RelationshipSource,
) {
  const result = [...existing];
  for (const fact of incoming) {
    const key = normalize(fact.label) + "|" + normalize(fact.value);
    const index = result.findIndex(
      (item) => normalize(item.label) + "|" + normalize(item.value) === key,
    );
    if (index >= 0) {
      const current = result[index];
      result[index] = {
        ...current,
        sourceIds: unique([...current.sourceIds, source.id]),
        lastObservedAt: source.observedAt,
      };
    } else {
      result.push({
        id: randomUUID(),
        ...fact,
        sourceIds: [source.id],
        firstObservedAt: source.observedAt,
        lastObservedAt: source.observedAt,
      });
    }
  }
  return result;
}

function mergeThreads(
  existing: ActiveRelationshipThread[],
  incoming: InteractionExtraction["activeThreads"],
  source: RelationshipSource,
) {
  const result = [...existing];
  for (const thread of incoming) {
    const key = normalize(thread.topic);
    const index = result.findIndex((item) => normalize(item.topic) === key);
    if (index >= 0) {
      const current = result[index];
      result[index] = {
        ...current,
        ...thread,
        sourceIds: unique([...current.sourceIds, source.id]),
        lastObservedAt: source.observedAt,
      };
    } else {
      result.push({
        id: randomUUID(),
        ...thread,
        sourceIds: [source.id],
        lastObservedAt: source.observedAt,
      });
    }
  }
  return result;
}

function mergeByKey<T>(existing: T[], incoming: T[], key: (item: T) => string) {
  const result = [...existing];
  const positions = new Map(result.map((item, index) => [key(item), index]));
  for (const item of incoming) {
    const itemKey = key(item);
    const index = positions.get(itemKey);
    if (index === undefined) {
      positions.set(itemKey, result.length);
      result.push(item);
    } else {
      result[index] = item;
    }
  }
  return result;
}

function unique<T extends string>(items: T[]): T[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))] as T[];
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function maxDate(current: string | null, candidate: string) {
  if (!current) return candidate;
  return candidate > current ? candidate : current;
}
