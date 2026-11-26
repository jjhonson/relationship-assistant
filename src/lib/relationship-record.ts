import { randomUUID } from "node:crypto";
import type {
  RelationshipContextValue,
  RelationshipInference,
  RelationshipRoleValue,
} from "./inference-benchmark";

export type RelationshipSource = {
  id: string;
  source: "gmail" | "transcript" | "manual" | "capture";
  observedAt: string;
  label: string;
  // Hash of unsaved pasted transcript + dated/source metadata, solely for retry identity.
  submissionDigest?: string;
};

export type RelationshipIdentity = {
  id: string;
  kind: "email";
  value: string;
  source: "gmail" | "capture";
  label: string;
  confirmed: boolean;
  sourceIds: string[];
};

export type DiscoveredRelationshipSeed = {
  personLabel: string;
  identity: {
    kind: "email";
    value: string;
    source: "gmail";
    label: string;
  };
  lastObservedAt: string | null;
  uncertainty: string;
  evidenceSummary: string[];
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
  // A user correction outranks later inference from older sources.
  userConfirmed?: true;
};

export type ActionableMemoryDisposition = "Done" | "Not relevant" | "Incorrect" | "Edit";
export type ActionableMemoryKind = "open-loop" | "opportunity";
export type ActionableMemoryFeedback = {
  kind: ActionableMemoryKind;
  key: string;
  disposition: ActionableMemoryDisposition;
  originalText: string;
  originalContext: string;
  sourceIds: string[];
  decidedAt: string;
  replacement?: { text: string; context: string };
};
export type ActionableMemoryTarget =
  | { kind: "open-loop"; commitment: string; owner: string }
  | { kind: "opportunity"; id: string };
export type DismissedConnectionSubject = {
  kind: "fact" | "thread" | "reason" | "opportunity" | "commitment";
  description: string;
  sourceIds: string[];
  dismissedAt: string;
};

export type RelationshipLabelSuggestion<T extends string> = {
  value: T;
  sourceIds: string[];
  lastSuggestedAt: string;
  verification: "Unverified";
};

export type RelationshipLabelAuthority = "user-confirmed" | "legacy-unverified" | "inferred-only";

export const relationshipIntentionModes = ["Stay in Touch", "Stay Connected", "Stay Close"] as const;
export type RelationshipIntentionMode = (typeof relationshipIntentionModes)[number];

export type RelationshipIntention = {
  mode: RelationshipIntentionMode | null;
  desiredOutcome: string;
  confirmedAt: string;
};

export type RelationshipRecord = {
  id: string;
  personLabel: string;
  // Present on new quick-capture records or after explicit name correction.
  personLabelAuthority?: "inferred-unverified" | "user-confirmed";
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string | null;
  classification: RelationshipInference["classification"]["value"];
  relationshipContexts: RelationshipContextValue[];
  relationshipRoles: RelationshipRoleValue[];
  // Set only by the user. Older saved relationships legitimately have no intention yet.
  intention?: RelationshipIntention | null;
  // Missing on older local records: their saved labels have unknown origin.
  labelAuthority?: RelationshipLabelAuthority;
  inferredRelationshipContexts?: RelationshipLabelSuggestion<RelationshipContextValue>[];
  inferredRelationshipRoles?: RelationshipLabelSuggestion<RelationshipRoleValue>[];
  disposition: RelationshipInference["disposition"]["value"];
  currentState: RelationshipInference["currentState"]["value"];
  tags: string[];
  history: RelationshipInference["history"];
  openLoops: Array<{
    commitment: string;
    owner: string;
    status: "Open" | "Overdue" | "Unclear";
    sourceIds: string[];
    userConfirmed?: true;
  }>;
  // Missing in older local JSON records.
  actionableMemoryFeedback?: ActionableMemoryFeedback[];
  dismissedConnectionSubjects?: DismissedConnectionSubject[];
  reasonsToEngage: Array<{
    reason: string;
    sourceIds: string[];
  }>;
  unknowns: string[];
  confidence: RelationshipInference["confidence"];
  identities: RelationshipIdentity[];
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
    existingFactId: string;
    category: DurableRelationshipFact["category"];
    label: string;
    value: string;
  }>;
  activeThreads: Array<{
    existingThreadId: string;
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
    relationshipContexts: [],
    relationshipRoles: [],
    intention: null,
    labelAuthority: "inferred-only",
    inferredRelationshipContexts: uniqueSuggestions(inference.relationshipContexts, sources),
    inferredRelationshipRoles: uniqueSuggestions(inference.relationshipRoles, sources),
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
    actionableMemoryFeedback: [],
    dismissedConnectionSubjects: [],
    reasonsToEngage: inference.reasonsToEngage.map((reason) => ({
      reason: reason.reason,
      sourceIds: reason.evidenceIds,
    })),
    unknowns: inference.unknowns,
    confidence: inference.confidence,
    identities: [],
    durableFacts: [],
    activeThreads: [],
    stewardshipOpportunities: [],
    sources,
  };
}

export function createManualRelationshipRecord(
  personLabel: string,
  context?: RelationshipContextValue | RelationshipContextValue[],
  role?: RelationshipRoleValue | RelationshipRoleValue[],
  now = new Date(),
): RelationshipRecord {
  const timestamp = now.toISOString();
  const relationshipContexts = unique(
    (Array.isArray(context) ? context : context ? [context] : []),
  );
  const relationshipRoles = unique(
    (Array.isArray(role) ? role : role ? [role] : []),
  );
  return {
    id: randomUUID(),
    personLabel: personLabel.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastInteractionAt: null,
    classification: classificationForContexts(relationshipContexts),
    relationshipContexts,
    relationshipRoles,
    intention: null,
    labelAuthority: "user-confirmed",
    inferredRelationshipContexts: [],
    inferredRelationshipRoles: [],
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
    actionableMemoryFeedback: [],
    dismissedConnectionSubjects: [],
    reasonsToEngage: [],
    unknowns: ["Historical relationship evidence has not been reconstructed yet."],
    confidence: "Low",
    identities: [],
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

export function createDiscoveredRelationshipRecord(
  seed: DiscoveredRelationshipSeed,
  contexts: RelationshipContextValue[] = [],
  roles: RelationshipRoleValue[] = [],
  now = new Date(),
): RelationshipRecord {
  const timestamp = now.toISOString();
  const observedAt = seed.lastObservedAt ?? timestamp.slice(0, 10);
  const source: RelationshipSource = {
    id: "gmail-metadata:" + randomUUID(),
    source: "gmail",
    observedAt,
    label: "Gmail metadata discovery",
  };
  const relationshipContexts = unique(contexts);
  const relationshipRoles = unique(roles);
  const evidence = seed.evidenceSummary.map((item) => item.trim()).filter(Boolean).join(" ");

  return {
    id: randomUUID(),
    personLabel: seed.personLabel.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastInteractionAt: seed.lastObservedAt,
    classification: classificationForContexts(relationshipContexts),
    relationshipContexts,
    relationshipRoles,
    intention: null,
    labelAuthority: "user-confirmed",
    inferredRelationshipContexts: [],
    inferredRelationshipRoles: [],
    disposition: "Relationship worth managing",
    currentState: "Unclear",
    tags: [],
    history: {
      earliestObservedMeaningfulInteraction: "",
      latestObservedMeaningfulInteraction: seed.lastObservedAt ?? "",
      pattern: [
        "Surfaced by bounded, metadata-only Gmail discovery.",
        seed.uncertainty ? "Discovery signal: " + seed.uncertainty + "." : "",
        evidence,
      ].filter(Boolean).join(" "),
      evidenceIds: [source.id],
    },
    openLoops: [],
    actionableMemoryFeedback: [],
    dismissedConnectionSubjects: [],
    reasonsToEngage: [],
    unknowns: [
      "Message content and full relationship history have not been reconstructed.",
      "Gmail discovery is bounded and incomplete; other channels may contain important context.",
    ],
    confidence: "Low",
    identities: [{
      id: randomUUID(),
      kind: seed.identity.kind,
      value: seed.identity.value.trim().toLowerCase(),
      source: seed.identity.source,
      label: seed.identity.label.trim(),
      confirmed: true,
      sourceIds: [source.id],
    }],
    durableFacts: [],
    activeThreads: [],
    stewardshipOpportunities: [],
    sources: [source],
  };
}

export function replaceRelationshipLabels(
  record: RelationshipRecord,
  contexts: RelationshipContextValue[],
  roles: RelationshipRoleValue[],
  now = new Date(),
): RelationshipRecord {
  const relationshipContexts = unique(contexts);
  const relationshipRoles = unique(roles);
  return {
    ...record,
    updatedAt: now.toISOString(),
    classification: classificationForContexts(relationshipContexts),
    relationshipContexts,
    relationshipRoles,
    labelAuthority: "user-confirmed",
    inferredRelationshipContexts: (record.inferredRelationshipContexts ?? []).filter(
      (item) => !relationshipContexts.includes(item.value),
    ),
    inferredRelationshipRoles: (record.inferredRelationshipRoles ?? []).filter(
      (item) => !relationshipRoles.includes(item.value),
    ),
  };
}

export function replaceRelationshipIntention(
  record: RelationshipRecord,
  mode: RelationshipIntentionMode | null,
  desiredOutcome: string,
  now = new Date(),
): RelationshipRecord {
  if (mode !== null && !relationshipIntentionModes.includes(mode)) {
    throw new Error("Invalid relationship intention mode.");
  }
  const outcome = desiredOutcome.trim();
  if (outcome.length > 600) {
    throw new Error("Relationship outcome must be 600 characters or fewer.");
  }
  const timestamp = now.toISOString();
  return {
    ...record,
    updatedAt: timestamp,
    intention: mode !== null || outcome
      ? { mode, desiredOutcome: outcome, confirmedAt: timestamp }
      : null,
  };
}

/**
 * Retire or replace an individually identified actionable memory.
 * Original source IDs remain in the audit trail even when the active
 * item is hidden. Corrected replacements are explicitly user-confirmed.
 */
export function correctActionableMemory(
  record: RelationshipRecord,
  target: ActionableMemoryTarget,
  disposition: ActionableMemoryDisposition,
  replacement: { text?: string; context?: string } = {},
  now = new Date(),
): RelationshipRecord {
  if (!["Done", "Not relevant", "Incorrect", "Edit"].includes(disposition)) {
    throw new Error("Unsupported memory correction.");
  }

  let key: string;
  let originalText: string;
  let originalContext: string;
  let sourceIds: string[];
  let status: "Open" | "Overdue" | "Unclear" = "Open";

  if (target.kind === "open-loop") {
    const current = record.openLoops.find((item) =>
      actionableKey("open-loop", item.commitment, item.owner) ===
      actionableKey("open-loop", target.commitment, target.owner));
    if (!current) throw new Error("Actionable memory not found.");
    key = actionableKey("open-loop", current.commitment, current.owner);
    originalText = current.commitment;
    originalContext = current.owner;
    sourceIds = [...current.sourceIds];
    status = current.status;
  } else if (target.kind === "opportunity") {
    const current = record.stewardshipOpportunities.find((item) => item.id === target.id);
    if (!current) throw new Error("Actionable memory not found.");
    key = actionableKey("opportunity", current.reason, current.trigger);
    originalText = current.reason;
    originalContext = current.trigger;
    sourceIds = [...current.sourceIds];
  } else {
    throw new Error("Unknown actionable memory target.");
  }

  const text = replacement.text?.trim() ?? "";
  const context = replacement.context?.trim() || originalContext;
  if (disposition === "Edit" && (text.length < 4 || text.length > 500 ||
      context.length < 1 || context.length > 240 ||
      (normalize(text) === normalize(originalText) && normalize(context) === normalize(originalContext)))) {
    throw new Error("Provide a meaningful corrected description (4–500 characters) or context.");
  }
  const timestamp = now.toISOString();
  const feedback: ActionableMemoryFeedback = {
    kind: target.kind, key, disposition,
    originalText, originalContext, sourceIds,
    decidedAt: timestamp,
    ...(disposition === "Edit" ? { replacement: { text, context } } : {}),
  };
  const newSource: RelationshipSource | null = disposition === "Edit" ? {
    id: "manual-correction:" + randomUUID(),
    source: "manual", observedAt: timestamp.slice(0, 10),
    label: "User-confirmed memory correction",
  } : null;
  const openLoops = record.openLoops.filter(
    (item) => actionableKey("open-loop", item.commitment, item.owner) !== key);
  const opportunities = record.stewardshipOpportunities.filter(
    (item) => actionableKey("opportunity", item.reason, item.trigger) !== key);

  if (newSource) {
    if (target.kind === "open-loop") {
      openLoops.push({
        commitment: text, owner: context, status, sourceIds: [newSource.id], userConfirmed: true,
      });
    } else {
      opportunities.push({
        id: randomUUID(), reason: text, trigger: context,
        sourceIds: [newSource.id], observedAt: timestamp.slice(0, 10), userConfirmed: true,
      });
    }
  }
  return {
    ...record,
    updatedAt: timestamp,
    actionableMemoryFeedback: [...(record.actionableMemoryFeedback ?? []), feedback],
    openLoops,
    stewardshipOpportunities: opportunities,
    sources: newSource ? [...record.sources, newSource] : record.sources,
  };
}

function actionableKey(kind: ActionableMemoryKind, content: string, context: string) {
  return JSON.stringify([kind, normalize(content), normalize(context)]);
}

function wasActionableMemoryRetired(
  record: RelationshipRecord, key: string, sourceId: string,
) {
  return (record.actionableMemoryFeedback ?? []).some((feedback) =>
    feedback.key === key &&
    (feedback.disposition !== "Done" || feedback.sourceIds.includes(sourceId)));
}

/**
 * A Done decision retires the original observed commitment, but later
 * independent evidence may establish a genuinely new obligation. Replaying
 * the old source must not then discard that newer, still-active instance.
 */
function mergeActiveOpenLoops(
  record: RelationshipRecord,
  incoming: InteractionExtraction["openLoops"],
  source: RelationshipSource,
): RelationshipRecord["openLoops"] {
  const confirmed = record.openLoops.filter((item) => item.userConfirmed === true);
  const earlierInferred = record.openLoops.filter((item) => !item.userConfirmed);
  const inferred = reconcileOpenLoops(earlierInferred, incoming, source)
    .filter((item) => !wasActionableMemoryRetired(
      record, actionableKey("open-loop", item.commitment, item.owner), source.id))
    .filter((item) => !confirmed.some((saved) =>
      actionableKey("open-loop", saved.commitment, saved.owner) ===
      actionableKey("open-loop", item.commitment, item.owner)));

  const reestablishedAfterCompletion = earlierInferred.filter((item) =>
    (record.actionableMemoryFeedback ?? []).some((feedback) =>
      feedback.disposition === "Done" &&
      feedback.key === actionableKey("open-loop", item.commitment, item.owner) &&
      item.sourceIds.some((id) => !feedback.sourceIds.includes(id))) &&
    !inferred.some((candidate) =>
      actionableKey("open-loop", candidate.commitment, candidate.owner) ===
      actionableKey("open-loop", item.commitment, item.owner)));

  return [...confirmed, ...reestablishedAfterCompletion, ...inferred];
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
    // Model suggestions never modify user-selected or legacy saved labels.
    inferredRelationshipContexts: mergeSuggestedLabels(
      record.inferredRelationshipContexts ?? [], extraction.relationshipContexts, record.relationshipContexts,
      record.labelAuthority === "user-confirmed", source,
    ),
    inferredRelationshipRoles: mergeSuggestedLabels(
      record.inferredRelationshipRoles ?? [], extraction.relationshipRoles, record.relationshipRoles,
      record.labelAuthority === "user-confirmed", source,
    ),
    tags: unique([...record.tags, ...extraction.tags]),
    currentState: "Active",
    openLoops: mergeActiveOpenLoops(record, extraction.openLoops, source),
    unknowns: unique([...record.unknowns, ...extraction.unknowns]),
    durableFacts: mergeFacts(record.durableFacts, extraction.durableFacts, source),
    activeThreads: mergeThreads(record.activeThreads, extraction.activeThreads, source),
    stewardshipOpportunities: [
      ...record.stewardshipOpportunities.filter((item) => item.userConfirmed === true),
      ...extraction.stewardshipOpportunities
        .filter((item) => !wasActionableMemoryRetired(
          record, actionableKey("opportunity", item.reason, item.trigger), source.id))
        .filter((item) => !record.stewardshipOpportunities.some((saved) => saved.userConfirmed &&
          actionableKey("opportunity", saved.reason, saved.trigger) ===
          actionableKey("opportunity", item.reason, item.trigger)))
        .map((item) => ({
          id: randomUUID(), ...item, sourceIds: [source.id],
          observedAt: source.observedAt,
        })),
    ],
    sources: mergeByKey(record.sources, [source], (item) => item.id),
  };
}

function uniqueSuggestions<T extends string>(
  items: Array<{ value: T; evidenceIds: string[] }>,
  sources: RelationshipSource[],
): RelationshipLabelSuggestion<T>[] {
  const suggestions: RelationshipLabelSuggestion<T>[] = [];
  for (const item of items) {
    const existing = suggestions.find((label) => label.value === item.value);
    if (existing) {
      existing.sourceIds = unique([...existing.sourceIds, ...item.evidenceIds]);
    } else {
      suggestions.push({
        value: item.value,
        sourceIds: unique(item.evidenceIds),
        lastSuggestedAt: sources[0]?.observedAt ?? "",
        verification: "Unverified",
      });
    }
  }
  return suggestions;
}

function mergeSuggestedLabels<T extends string>(
  existing: RelationshipLabelSuggestion<T>[],
  incoming: T[],
  recordedLabels: T[],
  recordedLabelsConfirmed: boolean,
  source: RelationshipSource,
): RelationshipLabelSuggestion<T>[] {
  const result = existing.map((item) => ({ ...item, sourceIds: [...item.sourceIds] }));
  for (const value of unique(incoming)) {
    if (recordedLabelsConfirmed && recordedLabels.includes(value)) continue;
    const prior = result.find((item) => item.value === value);
    if (prior) {
      prior.sourceIds = unique([...prior.sourceIds, source.id]);
      prior.lastSuggestedAt = source.observedAt;
    } else {
      result.push({
        value, sourceIds: [source.id], lastSuggestedAt: source.observedAt,
        verification: "Unverified",
      });
    }
  }
  return result;
}

function reconcileOpenLoops(
  existing: RelationshipRecord["openLoops"],
  incoming: InteractionExtraction["openLoops"],
  source: RelationshipSource,
) {
  return incoming.map((item) => {
    const key = normalize(item.commitment) + "|" + normalize(item.owner);
    const prior = existing.find(
      (loop) => normalize(loop.commitment) + "|" + normalize(loop.owner) === key,
    );
    if (!prior) {
      return { ...item, sourceIds: [source.id] };
    }
    return {
      ...prior,
      status: item.status,
      sourceIds: item.status === prior.status
        ? prior.sourceIds
        : unique([...prior.sourceIds, source.id]),
    };
  });
}

function mergeFacts(
  existing: DurableRelationshipFact[],
  incoming: InteractionExtraction["durableFacts"],
  source: RelationshipSource,
) {
  const result = [...existing];
  for (const fact of incoming) {
    const existingIndex = fact.existingFactId
      ? result.findIndex((item) => item.id === fact.existingFactId)
      : -1;
    const key = normalize(fact.label) + "|" + normalize(fact.value);
    const fallbackIndex = result.findIndex(
      (item) => normalize(item.label) + "|" + normalize(item.value) === key,
    );
    const index = existingIndex >= 0 ? existingIndex : fallbackIndex;
    const factValue = {
      category: fact.category,
      label: fact.label,
      value: fact.value,
    };
    if (index >= 0) {
      const current = result[index];
      result[index] = {
        ...current,
        ...factValue,
        sourceIds: unique([...current.sourceIds, source.id]),
        lastObservedAt: source.observedAt,
      };
    } else {
      result.push({
        id: randomUUID(),
        ...factValue,
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
    const existingIndex = thread.existingThreadId
      ? result.findIndex((item) => item.id === thread.existingThreadId)
      : -1;
    const key = normalize(thread.topic);
    const fallbackIndex = result.findIndex((item) => normalize(item.topic) === key);
    const index = existingIndex >= 0 ? existingIndex : fallbackIndex;
    const threadValue = {
      topic: thread.topic,
      state: thread.state,
      whyItMatters: thread.whyItMatters,
      nextChangeSignal: thread.nextChangeSignal,
    };
    if (index >= 0) {
      const current = result[index];
      result[index] = {
        ...current,
        ...threadValue,
        sourceIds: unique([...current.sourceIds, source.id]),
        lastObservedAt: source.observedAt,
      };
    } else {
      result.push({
        id: randomUUID(),
        ...threadValue,
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

function classificationForContexts(
  contexts: RelationshipContextValue[],
): RelationshipInference["classification"]["value"] {
  if (contexts.includes("Family") || contexts.includes("Personal relationship")) return "Friend or family";
  if (contexts.includes("Recruiter")) return "Recruiter";
  if (contexts.includes("Current coworker")) return "Coworker";
  if (contexts.includes("Service provider")) return "Service provider";
  if (contexts.length > 0) return "Professional contact";
  return "Unknown";
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
