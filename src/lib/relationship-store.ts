import "server-only";
import { isSupabaseStorageEnabled, readSupabaseDocument, mutateSupabaseDocument } from "./supabase-document-store";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyCaptureExtraction,
  connectedPeopleFromCaptures,
  dismissCapturedConnection,
  isCaptureForRelationship,
  newCaptureEvent,
  newImageCaptureEvent,
  resolveCapturePerson,
  sharedHouseholdContextFromCaptures,
  type CaptureEvent,
  type CaptureExtraction,
} from "./capture";
import { correctActionableMemory, mergeInteractionIntoRelationship, type InteractionExtraction,
  type RelationshipSource, type ActionableMemoryTarget,
  type ActionableMemoryDisposition, type RelationshipIdentity, type RelationshipRecord } from "./relationship-record";
import { createPersonalMoment, type PersonalMoment, type PersonalMomentInput } from "./personal-moment";
import { randomUUID } from "node:crypto";
import { buildConnectionCandidates, dismissConnectionCandidate } from "./connection-subjects";
import { applyCadencePreference, dismissCadenceCycle, relationshipToday } from "./relationship-cadence";
import { looksLikePastedConversation } from "./conversational-capture";
import {
  addConnectionEvent, makeConnectionJourney, type ConnectionJourney,
  type ConfirmedConnectionEvent,
} from "./connection-journey";

type StoreFile = {
  version: 1;
  relationships: RelationshipRecord[];
  // Optional in older version-1 files. No destructive migration required.
  captures: CaptureEvent[];
  // Optional in earlier version-1 files; add without rewriting old identities or memories.
  moments: PersonalMoment[];
  // Optional on old v1 JSON stores; added without rewriting any existing data.
  connectionJourneys: ConnectionJourney[];
};

let mutationQueue: Promise<unknown> = Promise.resolve();

function storePath() {
  const root = path.join(process.cwd(), ".data");
  return {
    root,
    file: path.join(process.cwd(), ".data", "relationships.json"),
  };
}

function emptyStore(): StoreFile {
  return { version: 1, relationships: [], captures: [], moments: [], connectionJourneys: [] };
}

function normalizeStore(raw: unknown): StoreFile {
  if (!raw || typeof raw !== "object") throw new Error("Unsupported relationship store format.");
  const parsed = raw as StoreFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.relationships)) {
    throw new Error("Unsupported relationship store format.");
  }
  return {
    ...parsed,
    captures: Array.isArray(parsed.captures) ? parsed.captures : [],
    connectionJourneys: parsed.connectionJourneys === undefined ? [] :
      Array.isArray(parsed.connectionJourneys) ? parsed.connectionJourneys :
      (() => { throw new Error("Unsupported connection journal store format."); })(),
    moments: parsed.moments === undefined ? [] : Array.isArray(parsed.moments) ? parsed.moments :
      (() => { throw new Error("Unsupported personal moments store format."); })(),
    relationships: parsed.relationships.map((relationship) => ({
      ...relationship,
      identities: Array.isArray(relationship.identities) ? relationship.identities : [],
      relationshipContexts: Array.isArray(relationship.relationshipContexts) ? relationship.relationshipContexts : [],
      relationshipRoles: Array.isArray(relationship.relationshipRoles) ? relationship.relationshipRoles : [],
      labelAuthority: relationship.labelAuthority ?? "legacy-unverified",
      inferredRelationshipContexts: Array.isArray(relationship.inferredRelationshipContexts)
        ? relationship.inferredRelationshipContexts : [],
      inferredRelationshipRoles: Array.isArray(relationship.inferredRelationshipRoles)
        ? relationship.inferredRelationshipRoles : [],
    })),
  };
}

async function readStore(): Promise<StoreFile> {
  if (isSupabaseStorageEnabled()) {
    const snapshot = await readSupabaseDocument();
    return normalizeStore(snapshot?.document ?? emptyStore());
  }
  const target = storePath();
  try {
    const raw = await readFile(/* turbopackIgnore: true */ target.file, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function writeStore(store: StoreFile) {
  const target = storePath();
  await mkdir(target.root, { recursive: true, mode: 0o700 });
  const temporary = target.file + ".tmp";
  await writeFile(temporary, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target.file);
}

function mutateStore<T>(update: (store: StoreFile) => T | Promise<T>): Promise<T> {
  // Serialize local, single-process writes so two quick saves do not overwrite each other.
  const result = mutationQueue.then(async () => {
    if (isSupabaseStorageEnabled()) {
      return mutateSupabaseDocument((raw) => normalizeStore(raw ?? emptyStore()), update);
    }
    const store = await readStore();
    const value = await update(store);
    await writeStore(store);
    return value;
  });
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function validateSubmissionId(id?: string) {
  if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid private save request identifier.");
  }
}
function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}

export async function listRelationships() {
  const store = await readStore();
  return [...store.relationships].sort((a, b) => a.personLabel.localeCompare(b.personLabel));
}

export async function getRelationship(id: string) {
  const store = await readStore();
  return store.relationships.find((relationship) => relationship.id === id) ?? null;
}

export async function findRelationshipByIdentity(
  source: RelationshipIdentity["source"],
  kind: RelationshipIdentity["kind"],
  value: string,
) {
  const normalized = value.trim().toLowerCase();
  const store = await readStore();
  return store.relationships.find((relationship) =>
    relationship.identities.some((identity) =>
      identity.source === source &&
      identity.kind === kind &&
      identity.value.trim().toLowerCase() === normalized,
    ),
  ) ?? null;
}

export async function saveRelationship(record: RelationshipRecord) {
  return mutateStore((store) => {
    const index = store.relationships.findIndex((relationship) => relationship.id === record.id);
    if (index >= 0) {
      store.relationships[index] = record;
    } else {
      store.relationships.push(record);
    }
    return record;
  });
}

/** An explicit request ID is retried atomically, never recreated after a lost response. */
export async function saveNewCapture(
  note: string, contextRelationshipId: string | null = null,
  options: { requestId?: string; reportedInteractionAt?: string } = {},
) {
  validateSubmissionId(options.requestId);
  if (options.reportedInteractionAt && !validDay(options.reportedInteractionAt)) {
    throw new Error("Invalid reported conversation date.");
  }
  const event = newCaptureEvent(note, contextRelationshipId, new Date(), options);
  return mutateStore((store) => {
    const id = options.requestId;
    if (id) {
      const existing = store.captures.find((capture) => capture.requestId === id);
      if (existing) {
        if (existing.note !== event.note ||
            existing.contextRelationshipId !== contextRelationshipId ||
            (existing.reportedInteractionAt ?? "") !== (options.reportedInteractionAt ?? "")) {
          throw new Error("This save request was already used for different text.");
        }
        return existing;
      }
      if (store.moments.some((item) => item.requestId === id) ||
          store.relationships.some((person) =>
            person.sources.some((source) => source.id === "pasted:" + id))) {
        throw new Error("This save request was already used for different material.");
      }
    }
    const index = contextRelationshipId
      ? store.relationships.findIndex((record) => record.id === contextRelationshipId) : -1;
    if (contextRelationshipId && index < 0) {
      throw new Error("The selected relationship was not found.");
    }
    store.captures.push(event);
    if (index >= 0 && options.reportedInteractionAt) {
      const person = store.relationships[index];
      const day = options.reportedInteractionAt;
      const sourceId = "capture:" + event.id;
      store.relationships[index] = {
        ...person,
        updatedAt: event.capturedAt,
        lastInteractionAt: person.lastInteractionAt && person.lastInteractionAt > day
          ? person.lastInteractionAt : day,
        sources: person.sources.some((source) => source.id === sourceId)
          ? person.sources : [...person.sources, {
            id: sourceId, source: "capture", observedAt: day,
            label: "Your note about a reported conversation",
          }],
      };
    }
    return event;
  });
}

export async function saveNewImageCapture(
  input: { note: string; sourceText: string; visualDetails: string },
  contextRelationshipId: string | null = null,
) {
  const event = newImageCaptureEvent(input, contextRelationshipId);
  return mutateStore((store) => {
    if (contextRelationshipId && !store.relationships.some((record) => record.id === contextRelationshipId)) {
      throw new Error("The selected relationship was not found.");
    }
    store.captures.push(event);
    return event;
  });
}

export async function getCapture(id: string) {
  const store = await readStore();
  return store.captures.find((event) => event.id === id) ?? null;
}

export async function listCapturesForRelationship(relationshipId: string) {
  const store = await readStore();
  return store.captures.filter((event) => isCaptureForRelationship(event, relationshipId))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function listConnectedPeopleForRelationship(relationshipId: string) {
  const store = await readStore();
  const known = new Map(store.relationships.map((record) => [record.id, record]));
  return connectedPeopleFromCaptures(store.captures, relationshipId).flatMap((connection) => {
    const related = known.get(connection.relatedRelationshipId);
    return related ? [{ ...connection, related }] : [];
  });
}

export async function listSharedHouseholdContextForRelationship(relationshipId: string) {
  const store = await readStore();
  const known = new Map(store.relationships.map((record) => [record.id, record]));
  return sharedHouseholdContextFromCaptures(store.captures, relationshipId).flatMap((context) => {
    const via = known.get(context.viaRelationshipId);
    return via ? [{ ...context, via }] : [];
  });
}

export async function listRecentCaptures() {
  const store = await readStore();
  return [...store.captures].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 8);
}

export async function saveCaptureInterpretation(id: string, extraction: CaptureExtraction) {
  return mutateStore((store) => {
    const index = store.captures.findIndex((event) => event.id === id);
    if (index < 0) throw new Error("Saved note not found.");
    const updated = applyCaptureExtraction(store.captures[index], extraction, store.relationships);
    store.captures[index] = updated.event;
    store.relationships = updated.relationships;
    return updated.event;
  });
}

export async function saveCapturePersonResolution(id: string, personIndex: number, selectedId: string) {
  return mutateStore((store) => {
    const index = store.captures.findIndex((event) => event.id === id);
    if (index < 0) throw new Error("Saved note not found.");
    const updated = resolveCapturePerson(store.captures[index], personIndex, selectedId, store.relationships);
    store.captures[index] = updated.event;
    store.relationships = updated.relationships;
    return updated.event;
  });
}

export async function saveConnectionDismissal(captureId: string, connectionId: string, relationshipId: string) {
  return mutateStore((store) => {
    const index = store.captures.findIndex((event) => event.id === captureId);
    if (index < 0) throw new Error("Saved note not found.");
    const updated = dismissCapturedConnection(store.captures[index], connectionId, relationshipId);
    const original = (store.captures[index].connections ?? []).find((link) => link.id === connectionId)!;
    // Dismiss all existing evidence for this same inferred link so an older suggestion
    // does not reappear immediately. The source notes themselves remain untouched.
    store.captures = store.captures.map((event, i) => ({
      ...(i === index ? updated : event),
      connections: ((i === index ? updated : event).connections ?? []).map((link) => {
        const samePair = (link.firstRelationshipId === original.firstRelationshipId &&
          link.secondRelationshipId === original.secondRelationshipId) ||
          (link.firstRelationshipId === original.secondRelationshipId &&
            link.secondRelationshipId === original.firstRelationshipId);
        return samePair && link.kind === original.kind ? { ...link, dismissed: true } : link;
      }),
    }));
    return updated;
  });
}


/** User-side moments are separate from third-party encounter/relationship memories. */
export async function listPersonalMoments() {
  const store = await readStore();
  return [...store.moments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPersonalMoment(id: string) {
  const store = await readStore();
  return store.moments.find((moment) => moment.id === id) ?? null;
}

export async function savePersonalMoment(input: PersonalMomentInput) {
  validateSubmissionId(input.requestId);
  const moment = createPersonalMoment(input);
  return mutateStore((store) => {
    if (input.requestId) {
      const existing = store.moments.find((item) => item.requestId === input.requestId);
      if (existing) {
        if (existing.description !== moment.description ||
            existing.reflection !== moment.reflection || existing.url !== moment.url ||
            existing.consideration !== moment.consideration) {
          throw new Error("This save request was already used for different text.");
        }
        return existing;
      }
      if (store.captures.some((capture) => capture.requestId === input.requestId) ||
          store.relationships.some((person) =>
            person.sources.some((source) => source.id === "pasted:" + input.requestId))) {
        throw new Error("This save request was already used for different material.");
      }
    }
    store.moments.push(moment);
    return moment;
  });
}


/** Changing eligibility is a local choice; it never initiates an AI review. */
export async function setPersonalMomentConsideration(
  id: string,
  consideration: PersonalMoment["consideration"],
) {
  if (consideration !== "private" && consideration !== "consider-people") {
    throw new Error("Invalid moment consideration choice.");
  }
  return mutateStore((store) => {
    const index = store.moments.findIndex((moment) => moment.id === id);
    if (index < 0) throw new Error("Saved moment not found.");
    store.moments[index] = { ...store.moments[index], consideration };
    return store.moments[index];
  });
}


/**
 * Intentionally recorded one-to-one connections. Suggested ideas are not
 * evidence of an action, and no contact channels are queried or changed here.
 */
export async function listConnectionJourneys(relationshipId: string) {
  const store = await readStore();
  return store.connectionJourneys.filter((item) => item.relationshipId === relationshipId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function startConnectionJourney(
  relationshipId: string,
  subject: string,
  basisId: string,
  userLabel: string,
) {
  return mutateStore((store) => {
    const person = store.relationships.find((item) => item.id === relationshipId);
    if (!person) throw new Error("Relationship not found.");
    let sourceIds: string[] = [];
    if (basisId) {
      const verified = buildConnectionCandidates(person, userLabel)
        .find((item) => item.id === basisId);
      if (!verified) throw new Error("The proposed connection is no longer supported by saved evidence.");
      sourceIds = verified.evidence.map((item) => item.id);
      const existing = store.connectionJourneys.find(
        (item) => item.relationshipId === relationshipId && item.basisId === basisId,
      );
      if (existing) return existing;
    }
    const journey = makeConnectionJourney(relationshipId, subject, {
      basisId, basisSourceIds: sourceIds,
    });
    store.connectionJourneys.push(journey);
    return journey;
  });
}

/** Save a reviewed update containing several actually reported events in one atomic write. */
export async function saveConfirmedConnectionEvents(
  relationshipId: string,
  journeyId: string,
  inputs: ConfirmedConnectionEvent[],
  today: string,
  confirmationId: string,
) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 5) {
    throw new Error("Choose one to five events to record.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(confirmationId)) {
    throw new Error("Invalid review confirmation ID.");
  }
  return mutateStore((store) => {
    const index = store.connectionJourneys.findIndex(
      (item) => item.id === journeyId && item.relationshipId === relationshipId,
    );
    const recordIndex = store.relationships.findIndex((item) => item.id === relationshipId);
    if (index < 0 || recordIndex < 0) throw new Error("Connection or person not found.");

    const existing = store.connectionJourneys[index].events
      .filter((event) => event.confirmationId === confirmationId);
    if (existing.length) {
      // A retry after uncertain network feedback must not duplicate activity
      // or relationship facts. Refuse reusing an ID for different material.
      const same = existing.length === inputs.length && existing.every((event, i) =>
        event.kind === inputs[i]?.kind && event.happenedOn === inputs[i]?.happenedOn &&
        event.summary === inputs[i]?.summary.trim() &&
        event.outcome === inputs[i]?.outcome.trim());
      if (!same) throw new Error("This confirmation ID was already used for a different update.");
      return { journey: store.connectionJourneys[index], events: existing, duplicate: true };
    }

    // Build in memory before mutating the store. If a later event has an invalid
    // date/status, no partial events or relationship context can be written.
    let journey = store.connectionJourneys[index];
    const applied = [];
    for (const input of inputs) {
      if (!input || typeof input.summary !== "string" || typeof input.outcome !== "string" ||
          typeof input.happenedOn !== "string" || typeof input.kind !== "string" ||
          looksLikePastedConversation(input.summary) || looksLikePastedConversation(input.outcome)) {
        throw new Error("Use short original summaries, not pasted third-party conversations.");
      }
      const next = addConnectionEvent(journey, input, today);
      if (applied.length && next.event.happenedOn < applied[applied.length - 1].happenedOn) {
        throw new Error("Review event order: record the earliest action first.");
      }
      const tagged = { ...next.event, confirmationId };
      journey = { ...next.journey, events: [...next.journey.events.slice(0, -1), tagged] };
      applied.push(tagged);
    }

    let updated = store.relationships[recordIndex];
    for (const event of applied) {
      // Drafting and scheduling are not evidence of contact.
      if (!["sent", "reply_received", "interaction_occurred"].includes(event.kind)) continue;
      const lastInteractionAt = updated.lastInteractionAt && updated.lastInteractionAt > event.happenedOn
        ? updated.lastInteractionAt : event.happenedOn;
      updated = { ...updated, lastInteractionAt, updatedAt: event.recordedAt };

      // Only actually reported replies or completed interactions can teach
      // sourced person context. Preserve aspirations as stated, never upgraded.
      if ((event.kind === "reply_received" || event.kind === "interaction_occurred") && event.outcome) {
        const key = event.outcome.trim().toLowerCase().replace(/\s+/g, " ");
        const alreadyLearned = updated.durableFacts.some((fact) =>
          fact.label === "Connection outcome" &&
          fact.value.trim().toLowerCase().replace(/\s+/g, " ") === key);
        if (!alreadyLearned) {
          const sourceId = "connection-event:" + event.id;
          updated = {
            ...updated,
            sources: [...updated.sources, {
              id: sourceId, source: "manual" as const,
              observedAt: event.happenedOn,
              label: "User-confirmed connection outcome (not externally verified)",
            }],
            durableFacts: [...updated.durableFacts, {
              id: randomUUID(), category: "Personal" as const, label: "Connection outcome",
              value: event.outcome, sourceIds: [sourceId],
              firstObservedAt: event.happenedOn, lastObservedAt: event.happenedOn,
            }],
          };
        }
      }
    }

    store.connectionJourneys[index] = journey;
    store.relationships[recordIndex] = updated;
    return { journey, events: applied, duplicate: false };
  });
}

/** Preserve a pasted conversation's extracted evidence without storing its raw text.
 * The source ID and hash bind one browser save attempt to one immutable report.
 */
export async function saveInferredConversation(
  relationshipId: string, extraction: InteractionExtraction, source: RelationshipSource,
  requestId?: string, initialRecord?: RelationshipRecord,
) {
  validateSubmissionId(requestId);
  if (initialRecord && (!requestId || initialRecord.id !== requestId ||
      relationshipId !== initialRecord.id || source.id !== "pasted:" + requestId ||
      !source.submissionDigest)) throw new Error("Invalid new-person save request.");
  return mutateStore((store) => {
    if (requestId &&
        (store.captures.some((capture) => capture.requestId === requestId) ||
         store.moments.some((moment) => moment.requestId === requestId))) {
      throw new Error("This save request was already used for different material.");
    }
    if (requestId && store.relationships.some((person) =>
      person.id !== relationshipId && person.sources.some((item) => item.id === source.id))) {
      throw new Error("This save request belongs to another relationship.");
    }
    const index = store.relationships.findIndex((item) => item.id === relationshipId);
    if (index < 0) {
      if (!initialRecord) throw new Error("Relationship not found.");
      if (store.relationships.some((person) =>
          person.personLabel.trim().toLowerCase() === initialRecord.personLabel.trim().toLowerCase())) {
        throw new Error("A person with that name already exists. Select the existing relationship or distinguish the name.");
      }
      store.relationships.push(mergeInteractionIntoRelationship(initialRecord, extraction, source));
      return { relationshipId, duplicate: false as const };
    }
    const existing = store.relationships[index].sources.find((item) => item.id === source.id);
    if (existing) {
      if (!requestId || !source.submissionDigest ||
          existing.submissionDigest !== source.submissionDigest) {
        throw new Error("This save request was already used for different text.");
      }
      return { relationshipId, duplicate: true as const };
    }
    if (initialRecord) throw new Error("This new-person save request conflicts with an existing relationship.");
    store.relationships[index] = mergeInteractionIntoRelationship(
      store.relationships[index], extraction, source,
    );
    return { relationshipId, duplicate: false as const };
  });
}

/** Existing single-event callers retain their old result shape and behavior. */
export async function saveConfirmedConnectionEvent(
  relationshipId: string,
  journeyId: string,
  input: ConfirmedConnectionEvent,
  today: string,
) {
  const result = await saveConfirmedConnectionEvents(
    relationshipId, journeyId, [input], today, randomUUID(),
  );
  return { journey: result.journey, event: result.events[0] };
}


/** Atomic, source-preserving correction, never a read-then-blind-overwrite. */
export async function correctSavedActionableMemory(
  relationshipId: string,
  target: ActionableMemoryTarget,
  decision: ActionableMemoryDisposition,
  replacement: { text?: string; context?: string } = {},
) {
  return mutateStore((store) => {
    const index = store.relationships.findIndex((record) => record.id === relationshipId);
    if (index < 0) throw new Error("Relationship not found.");
    const updated = correctActionableMemory(store.relationships[index], target, decision, replacement);
    store.relationships[index] = updated;
    return updated;
  });
}

/** A cadence preference is separate from identity and memory; mutate atomically. */
export async function saveRelationshipCadence(relationshipId: string, days: number | undefined) {
  return mutateStore((store) => {
    const index = store.relationships.findIndex((record) => record.id === relationshipId);
    if (index < 0) throw new Error("Relationship not found.");
    const updated = applyCadencePreference(store.relationships[index], days);
    store.relationships[index] = updated;
    return updated;
  });
}

/** Declining a suggestion is not the same as denying its underlying memory. */
export async function dismissSavedConnectionSuggestion(relationshipId: string, basisId: string, userLabel: string) {
  return mutateStore((store) => {
    const index = store.relationships.findIndex((record) => record.id === relationshipId);
    if (index < 0) throw new Error("Relationship not found.");
    const person = store.relationships[index];
    if (basisId.startsWith("cadence:")) {
      const updated = dismissCadenceCycle(person, basisId, relationshipToday());
      store.relationships[index] = updated;
      return updated;
    }
    const candidate = buildConnectionCandidates(person, userLabel)
      .find((item) => item.id === basisId);
    if (!candidate) throw new Error("The suggestion is no longer available.");
    const updated = dismissConnectionCandidate(person, candidate);
    store.relationships[index] = updated;
    return updated;
  });
}
