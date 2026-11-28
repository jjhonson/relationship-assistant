import { createHash, randomUUID } from "node:crypto";
import { captureLocalDay } from "../capture-calendar";
import type { CaptureEvent } from "../capture";
import type { ConnectionJourney } from "../connection-journey";
import { validPastDate } from "../connection-journey";
import { relationshipContactFieldForFact } from "../relationship-overview";
import { locationMeaning } from "../location-meaning";
import type { DurableRelationshipFact, InteractionExtraction, RelationshipRecord, RelationshipSource } from "../relationship-record";
import { normalizePersonImportScope, isPersonImportProviderId, type PersonImportScope,
  type PersonImportCandidate } from "./person-import";

type Observation = Pick<DurableRelationshipFact, "category" | "label" | "value">;
type GmailProvenance = NonNullable<RelationshipSource["gmailImport"]>;

export type PersonImportMemoryInput = {
  scope: PersonImportScope;
  candidate: PersonImportCandidate;
  /** Extracted observations only. No message body, subject or raw transcript. */
  extraction: Pick<InteractionExtraction, "durableFacts">;
};

type ReviewReason = "identity-conflict" | "provider-conflict" | "possible-manual-overlap";
export type PersonImportMemoryResult =
  | { kind: "saved"; record: RelationshipRecord; deferredFactCount: number }
  | { kind: "duplicate"; relationshipId: string }
  | { kind: "needs-review"; relationshipId: string; reason: ReviewReason };

type PersonImportAssessment =
  | { kind: "ready"; record: RelationshipRecord; scope: PersonImportScope; day: string; sourceId: string }
  | Exclude<PersonImportMemoryResult, { kind: "saved" }>;

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function sameValue(a: Observation, b: Observation) {
  return normalized(a.value) === normalized(b.value);
}
function attribute(fact: DurableRelationshipFact, sources: ReadonlyMap<string, RelationshipSource>) {
  const contact = relationshipContactFieldForFact(fact, sources);
  const location = locationMeaning(fact, sources);
  return contact ? "contact:" + contact : location ? "location:" + location :
    "fact:" + fact.category + ":" + normalized(fact.label);
}

function knownEmail(record: RelationshipRecord, address: string) {
  const sources = new Map(record.sources.map((item) => [item.id, item]));
  return record.sources.some((source) => source.gmailImport?.contactAddress === address) ||
    record.identities.some((item) => item.kind === "email" && normalized(item.value) === address) ||
    record.durableFacts.some((fact) => relationshipContactFieldForFact(fact, sources) === "Email" &&
      normalized(fact.value) === address);
}

function sameProvenance(gmail: GmailProvenance | undefined, scope: PersonImportScope, candidate: PersonImportCandidate) {
  return !!gmail && gmail.providerKey === candidate.providerKey &&
    gmail.mailboxAddress === scope.mailboxAddress && gmail.messageId === candidate.messageId &&
    gmail.threadId === candidate.threadId && gmail.observedInstant === candidate.observedAt &&
    gmail.direction === candidate.direction && gmail.contactAddress === candidate.contactAddress;
}

function hasPossibleManualOverlap(record: RelationshipRecord, captures: readonly CaptureEvent[],
  journeys: readonly ConnectionJourney[], day: string) {
  // Earlier manual imports did not retain provider IDs or message-level content
  // hashes. Same-day contact is a REVIEW cue, not proof that these are duplicates.
  // In particular a separate meeting may legitimately happen on the same day.
  return record.sources.some((source) => !source.gmailImport && source.observedAt === day &&
      (source.id.startsWith("pasted:") || source.source === "transcript")) ||
    captures.some((capture) => capture.reportedInteractionAt === day &&
      (capture.contextRelationshipId === record.id ||
        capture.people.some((person) => person.relationshipId === record.id))) ||
    journeys.some((journey) => journey.relationshipId === record.id &&
      journey.events.some((event) => event.happenedOn === day &&
        ["sent", "reply_received", "interaction_occurred"].includes(event.kind)));
}

const categories = new Set(["Family", "Location", "Interest", "Work", "Personal", "Other"]);
function readObservations(extraction: PersonImportMemoryInput["extraction"]): Observation[] {
  if (!Array.isArray(extraction?.durableFacts) || extraction.durableFacts.length > 40) {
    throw new Error("Invalid bounded Gmail memory extraction.");
  }
  return extraction.durableFacts.map((fact) => {
    if (!fact || !categories.has(fact.category) ||
        typeof fact.label !== "string" || typeof fact.value !== "string" ||
        !fact.label.trim() || fact.label.length > 120 || !fact.value.trim() ||
        fact.value.length > 500 || /[\r\n]/.test(fact.label) || /[\r\n]/.test(fact.value)) {
      throw new Error("Invalid structured Gmail observation.");
    }
    // The existing conversation extraction contract defines City as current
    // residence, never office or profile geography. Use its explicit label.
    return { category: fact.category, label: fact.category === "Location" &&
      normalized(fact.label) === "city" ? "Home location" : fact.label.trim(), value: fact.value.trim() };
  });
}

function hasNonGmailEvidence(fact: DurableRelationshipFact, sources: ReadonlyMap<string, RelationshipSource>) {
  return fact.sourceIds.length === 0 || fact.sourceIds.some((id) => !sources.get(id)?.gmailImport);
}

/**
 * Apply one structured, previously consented, body-backed message to the latest
 * private dataset. Pure domain mutation: does not access Gmail or any model.
 * Deliberately additive. Never accept model-supplied IDs as overwrite authority;
 * never create active commitments, opportunities or evolving-thread states
 * from this first historical import path. Defer manual overlaps and conflicts
 * instead of manufacturing a match or silently replacing current memory.
 */
export function assessPersonImportMemory(
  records: readonly RelationshipRecord[],
  captures: readonly CaptureEvent[],
  journeys: readonly ConnectionJourney[],
  input: Pick<PersonImportMemoryInput, "scope" | "candidate">,
  now = new Date(),
  timeZone = process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
): PersonImportAssessment {
  const scope = normalizePersonImportScope(input.scope);
  const message = input.candidate;
  const instant = Date.parse(message.observedAt);
  if (!isPersonImportProviderId(message.messageId) || !isPersonImportProviderId(message.threadId) ||
      message.providerKey !== "gmail:" + scope.mailboxAddress + ":" + message.messageId ||
      !scope.confirmedAddresses.includes(message.contactAddress) ||
      !["sent", "received"].includes(message.direction) ||
      !Number.isFinite(instant) || new Date(instant).toISOString() !== message.observedAt ||
      instant > now.getTime()) {
    throw new Error("Invalid dated Gmail memory evidence.");
  }
  const day = captureLocalDay(message.observedAt, timeZone);
  if (!validPastDate(day, captureLocalDay(now.toISOString(), timeZone))) {
    throw new Error("Invalid Gmail contact day.");
  }
  const record = records.find((item) => item.id === scope.personId);
  if (!record) throw new Error("Relationship not found.");
  const review = (reason: ReviewReason): PersonImportAssessment =>
    ({ kind: "needs-review", relationshipId: record.id, reason });
  const sourceId = "gmail-import:" + createHash("sha256").update(message.providerKey).digest("hex");
  const owners = records.flatMap((person) => person.sources
    .filter((source) => source.id === sourceId || source.gmailImport?.providerKey === message.providerKey)
    .map((source) => ({ person, source })));
  if (owners.length) {
    if (owners.length === 1 && owners[0].person.id === record.id &&
        owners[0].source.id === sourceId && sameProvenance(owners[0].source.gmailImport, scope, message)) {
      return { kind: "duplicate", relationshipId: record.id };
    }
    return review("provider-conflict");
  }
  if (records.some((person) => person.id !== record.id &&
      scope.confirmedAddresses.some((address) => knownEmail(person, address)))) return review("identity-conflict");
  if (hasPossibleManualOverlap(record, captures, journeys, day)) return review("possible-manual-overlap");

  return { kind: "ready", record, scope, day, sourceId };
}

export function applyPersonImportMemory(
  records: readonly RelationshipRecord[],
  captures: readonly CaptureEvent[],
  journeys: readonly ConnectionJourney[],
  input: PersonImportMemoryInput,
  now = new Date(),
  timeZone = process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
): PersonImportMemoryResult {
  const assessment = assessPersonImportMemory(records, captures, journeys, input, now, timeZone);
  if (assessment.kind !== "ready") return assessment;
  const { record, scope, day, sourceId } = assessment;
  const message = input.candidate;
  const source: RelationshipSource = {
    id: sourceId,
    source: "gmail",
    observedAt: day,
    label: message.direction === "sent" ? "Sent email · Gmail" : "Received email · Gmail",
    gmailImport: {
      providerKey: message.providerKey, mailboxAddress: scope.mailboxAddress,
      messageId: message.messageId, threadId: message.threadId,
      observedInstant: message.observedAt, importedAt: now.toISOString(),
      direction: message.direction, contactAddress: message.contactAddress,
      deferredFacts: [],
    },
  };
  const sources = new Map([...record.sources, source].map((item) => [item.id, item]));
  const facts = [...record.durableFacts];
  const deferred: Observation[] = [];
  const observations: Observation[] = [
    { category: "Personal", label: "Email", value: message.contactAddress },
    ...readObservations(input.extraction),
  ];
  // A body's signature or forwarded content does not confirm another alias.
  // Only the already confirmed visible From/To address is added as email evidence.
  for (const observation of observations) {
    const proposed: DurableRelationshipFact = {
      ...observation, id: randomUUID(), sourceIds: [source.id], firstObservedAt: day, lastObservedAt: day,
    };
    const field = relationshipContactFieldForFact(proposed, sources);
    if (field === "Email" && normalized(proposed.value) !== message.contactAddress) continue;
    const key = attribute(proposed, sources);
    const matching = facts.filter((item) => attribute(item, sources) === key);
    const differing = matching.filter((item) => !sameValue(item, proposed));
    const exact = matching.find((item) => sameValue(item, proposed));
    // Protect prior non-provider evidence even against a more recent import;
    // keep conflicting observations attached to the new source for later review.
    // Where only Gmail supplied a contact field, distinct dated values can
    // coexist; the existing projection chooses the uniquely latest day.
    // Non-contact conflicts need semantic interpretation, not last-write-wins.
    const conflictingIdentity = field === "Email" && record.identities.some((identity) =>
      identity.kind === "email" && normalized(identity.value) !== normalized(proposed.value));
    if (conflictingIdentity || (differing.length > 0 &&
        (!field || matching.some((item) => hasNonGmailEvidence(item, sources))))) {
      if (!deferred.some((item) => item.category === observation.category &&
          normalized(item.label) === normalized(observation.label) && sameValue(item, observation))) {
        deferred.push(observation);
      }
      continue;
    }
    if (exact) {
      // Replaying older evidence must not move the current observation backwards.
      const position = facts.indexOf(exact);
      facts[position] = {
        ...exact,
        sourceIds: [...new Set([...exact.sourceIds, source.id])],
        firstObservedAt: day < exact.firstObservedAt ? day : exact.firstObservedAt,
        lastObservedAt: day > exact.lastObservedAt ? day : exact.lastObservedAt,
      };
    } else {
      facts.push(proposed);
    }
  }

  const latest = record.lastInteractionAt && record.lastInteractionAt > day ? record.lastInteractionAt : day;
  const savedSource = { ...source, gmailImport: { ...source.gmailImport!, deferredFacts: deferred } };
  return {
    kind: "saved",
    deferredFactCount: deferred.length,
    record: {
      ...record, updatedAt: now.toISOString(), lastInteractionAt: latest,
      durableFacts: facts, sources: [...record.sources, savedSource],
    },
  };
}
