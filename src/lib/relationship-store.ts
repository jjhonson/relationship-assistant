import "server-only";
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
import type { RelationshipIdentity, RelationshipRecord } from "./relationship-record";
import { createPersonalMoment, type PersonalMoment, type PersonalMomentInput } from "./personal-moment";
import { randomUUID } from "node:crypto";
import { buildConnectionCandidates } from "./connection-subjects";
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

async function readStore(): Promise<StoreFile> {
  const target = storePath();
  try {
    const raw = await readFile(/* turbopackIgnore: true */ target.file, "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
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
        // Older saved records mixed user and model labels, so provenance cannot be backfilled.
        labelAuthority: relationship.labelAuthority ?? "legacy-unverified",
        inferredRelationshipContexts: Array.isArray(relationship.inferredRelationshipContexts)
          ? relationship.inferredRelationshipContexts : [],
        inferredRelationshipRoles: Array.isArray(relationship.inferredRelationshipRoles)
          ? relationship.inferredRelationshipRoles : [],
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, relationships: [], captures: [], moments: [], connectionJourneys: [] };
    }
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
    const store = await readStore();
    const value = await update(store);
    await writeStore(store);
    return value;
  });
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
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

export async function saveNewCapture(note: string, contextRelationshipId: string | null = null) {
  const event = newCaptureEvent(note, contextRelationshipId);
  return mutateStore((store) => {
    if (contextRelationshipId && !store.relationships.some((record) => record.id === contextRelationshipId)) {
      throw new Error("The selected relationship was not found.");
    }
    store.captures.push(event);
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
  const moment = createPersonalMoment(input);
  return mutateStore((store) => {
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
