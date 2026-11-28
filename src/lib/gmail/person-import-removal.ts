import { createHash, randomUUID } from "node:crypto";
import { captureLocalDay } from "../capture-calendar";
import type { CaptureEvent } from "../capture";
import { validPastDate, type ConnectionJourney } from "../connection-journey";
import type { RelationshipRecord, RelationshipSource, DurableRelationshipFact } from "../relationship-record";

const MAX_REMOVE_SOURCES = 1000;
function isImportedSource(source: RelationshipSource) {
  return source.source === "gmail" && !!source.gmailImport && /^gmail-import:[0-9a-f]{64}$/.test(source.id);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map((item) => canonical(item)).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return "{" + Object.keys(object).sort().filter((key) => object[key] !== undefined)
      .map((key) => JSON.stringify(key) + ":" + canonical(object[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
function version(record: RelationshipRecord) {
  return createHash("sha256").update(canonical(record)).digest("hex");
}

export type GmailMemoryReview = {
  version: string;
  sources: {
    id: string; day: string; direction: "sent" | "received"; mailbox: string;
    facts: { label: string; value: string; otherEvidence: boolean }[];
    deferredFacts: { label: string; value: string }[];
  }[];
};

/** Review current linked values, not a reconstruction of the original email. */
export function reviewPersonGmailMemory(record: RelationshipRecord): GmailMemoryReview {
  return {
    version: version(record),
    sources: record.sources.filter(isImportedSource).map((source) => ({
      id: source.id, day: source.observedAt, direction: source.gmailImport!.direction,
      mailbox: source.gmailImport!.mailboxAddress,
      facts: record.durableFacts.filter((fact) => fact.sourceIds.includes(source.id))
        .map(({ label, value, sourceIds }) => ({ label, value, otherEvidence: sourceIds.some((id) => id !== source.id) })),
      deferredFacts: source.gmailImport!.deferredFacts.map(({ label, value }) => ({ label, value })),
    })).sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id)),
  };
}

function hasSource(item: { sourceIds: string[] }, selected: ReadonlySet<string>) {
  return item.sourceIds.some((id) => selected.has(id));
}

function remainingFact(fact: DurableRelationshipFact, selected: ReadonlySet<string>,
  sources: Map<string, RelationshipSource>, today: string): DurableRelationshipFact | null {
  if (!hasSource(fact, selected)) return fact;
  const sourceIds = fact.sourceIds.filter((id) => !selected.has(id));
  if (!sourceIds.length) return null;
  const removedDays = new Set(fact.sourceIds.filter((id) => selected.has(id))
    .map((id) => sources.get(id)?.observedAt));
  const remainingDays = sourceIds.flatMap((id) => {
    const day = sources.get(id)?.observedAt;
    return day && validPastDate(day, today) ? [day] : [];
  }).sort();
  // Preserve the value and independent dates. Only repair endpoints which
  // could have been supplied by a removed source. Old mutable fact links
  // may describe earlier context, not exact independent value observations.
  if (!remainingDays.length && (removedDays.has(fact.firstObservedAt) || removedDays.has(fact.lastObservedAt))) {
    throw new Error("A shared observation needs independent dated evidence before removal.");
  }
  let first = removedDays.has(fact.firstObservedAt) ? remainingDays[0] ?? fact.firstObservedAt : fact.firstObservedAt;
  let last = removedDays.has(fact.lastObservedAt) ? remainingDays.at(-1) ?? fact.lastObservedAt : fact.lastObservedAt;
  if (first > last && remainingDays.length) {
    first = remainingDays[0];
    last = remainingDays.at(-1)!;
  }
  return { ...fact, sourceIds, firstObservedAt: first, lastObservedAt: last };
}

export function planGmailMemoryRemoval(
  record: RelationshipRecord, captures: readonly CaptureEvent[], journeys: readonly ConnectionJourney[],
  sourceIds: string[], reviewVersion: string, now = new Date(),
  timeZone = process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
) {
  if (typeof reviewVersion !== "string" || reviewVersion !== version(record)) {
    throw new Error("The relationship changed. Review the selected sources again.");
  }
  if (!Array.isArray(sourceIds) || sourceIds.length < 1 || sourceIds.length > MAX_REMOVE_SOURCES ||
      sourceIds.some((id) => typeof id !== "string" || !/^gmail-import:[0-9a-f]{64}$/.test(id))) {
    throw new Error("Select saved Gmail messages to remove.");
  }
  const selected = new Set(sourceIds);
  if (selected.size !== sourceIds.length) throw new Error("Duplicate selected source.");
  const removed = record.sources.filter((source) => selected.has(source.id));
  if (removed.length !== selected.size || removed.some((source) => !isImportedSource(source))) {
    throw new Error("A selected source is not an imported Gmail message.");
  }
  // The current Gmail path produces only sources and durable observations.
  // If a future path adds independently mutable dependent memory types, fail
  // closed rather than delete commitments/confirmed identity or corrupt them.
  const unexpected = [
    ...record.identities, ...record.activeThreads, ...record.openLoops,
    ...record.stewardshipOpportunities, ...record.reasonsToEngage,
    ...(record.inferredRelationshipContexts ?? []), ...(record.inferredRelationshipRoles ?? []),
    ...(record.actionableMemoryFeedback ?? []),
  ];
  if (unexpected.some((item) => hasSource(item, selected)) ||
      record.history.evidenceIds.some((id) => selected.has(id))) {
    throw new Error("A selected source has additional dependent memory that requires review.");
  }
  const today = captureLocalDay(now.toISOString(), timeZone);
  const known = new Map(record.sources.map((source) => [source.id, source]));
  const sources = record.sources.filter((source) => !selected.has(source.id));
  const durableFacts = record.durableFacts.flatMap((fact) => {
    const next = remainingFact(fact, selected, known, today);
    return next ? [next] : [];
  });
  const preservedFacts = record.durableFacts.filter((fact) => hasSource(fact, selected) &&
    fact.sourceIds.some((id) => !selected.has(id))).length;
  // Dismissed suggestions may contain the deleted inferred fact itself.
  // A user-authored/confirmed journal entry remains independent; only its
  // deleted basis link is detached. Never delete a reported actual event.
  const dismissedConnectionSubjects = (record.dismissedConnectionSubjects ?? []).flatMap((item) => {
    if (!hasSource(item, selected)) return [item];
    const remaining = item.sourceIds.filter((id) => !selected.has(id));
    return remaining.length ? [{ ...item, sourceIds: remaining }] : [];
  });
  const updatedJourneys = journeys.map((journey) => {
    if (!journey.basisSourceIds.some((id) => selected.has(id))) return journey;
    if (journey.relationshipId !== record.id) throw new Error("A selected source is linked to another relationship.");
    const basisSourceIds = journey.basisSourceIds.filter((id) => !selected.has(id));
    return { ...journey, basisSourceIds, basisId: basisSourceIds.length ? journey.basisId : "" };
  });

  let lastInteractionAt = record.lastInteractionAt;
  if (lastInteractionAt && removed.some((source) => source.observedAt === lastInteractionAt)) {
    const possible = [
      record.gmailBaselineContactDay,
      record.history.latestObservedMeaningfulInteraction,
      ...sources.filter((source) => isImportedSource(source) || source.source === "transcript" ||
        source.id.startsWith("pasted:")).map((source) => source.observedAt),
      ...captures.filter((capture) => capture.contextRelationshipId === record.id ||
        capture.people.some((person) => person.relationshipId === record.id)).map((capture) => capture.reportedInteractionAt),
      ...updatedJourneys.filter((journey) => journey.relationshipId === record.id)
        .flatMap((journey) => journey.events.filter((event) =>
          ["sent", "reply_received", "interaction_occurred"].includes(event.kind)).map((event) => event.happenedOn)),
    ].filter((day): day is string => typeof day === "string" && validPastDate(day, today));
    lastInteractionAt = possible.sort().at(-1) ?? null;
  }
  const next: RelationshipRecord = {
    ...record, sources, durableFacts, lastInteractionAt, dismissedConnectionSubjects,
    updatedAt: now.toISOString(), gmailMemoryRevision: randomUUID(),
  };
  if (!sources.some(isImportedSource)) delete next.gmailBaselineContactDay;
  if (lastInteractionAt !== record.lastInteractionAt) delete next.dismissedCadenceCycle;
  return {
    record: next, journeys: updatedJourneys,
    removedMessages: removed.length, removedFacts: record.durableFacts.length - durableFacts.length, preservedFacts,
  };
}
