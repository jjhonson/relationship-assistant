import { randomUUID } from "node:crypto";
import {
  createManualRelationshipRecord,
  type DurableRelationshipFact,
  type RelationshipRecord,
  type RelationshipSource,
} from "./relationship-record";

export type CaptureFact = {
  category: DurableRelationshipFact["category"];
  label: string;
  value: string;
};

export type CaptureParticipant = {
  name: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  city: string;
  linkedin: string;
  facts: CaptureFact[];
};

export type CaptureExtraction = {
  summary: string;
  participants: CaptureParticipant[];
  sharedDetails: string[];
  // Only information explicitly about a shared home/household is eligible to be
  // surfaced on another household member's page. Other group details stay local.
  householdDetails?: string[];
  connections?: CaptureConnection[];
  otherPeople: Array<{ name: string; connection: string }>;
  commitments: Array<{ owner: string; description: string }>;
};

export type CaptureConnection = {
  firstName: string;
  secondName: string;
  kind: "household" | "family" | "colleague" | "other";
  description: string;
};

export type CapturedConnection = CaptureConnection & {
  id: string;
  firstRelationshipId: string | null;
  secondRelationshipId: string | null;
  dismissed: boolean;
};

export type CapturedPerson = CaptureParticipant & {
  resolution: "created" | "linked" | "needs-review";
  relationshipId: string | null;
  candidateIds: string[];
};

export type CaptureEvent = {
  id: string;
  capturedAt: string;
  source: "user-text" | "user-image";
  // Text notes are user-authored. Image captures preserve the user's optional note separately
  // from the text and visual details extracted from the intentionally supplied image.
  note: string;
  sourceText?: string;
  visualDetails?: string;
  contextRelationshipId: string | null;
  status: "pending" | "interpreted";
  summary: string;
  people: CapturedPerson[];
  sharedDetails: string[];
  householdDetails?: string[];
  connections?: CapturedConnection[];
  otherPeople: CaptureExtraction["otherPeople"];
  commitments: CaptureExtraction["commitments"];
};

export function newCaptureEvent(note: string, contextRelationshipId: string | null, now = new Date()): CaptureEvent {
  const value = note.trim();
  if (!value || value.length > 5_000) throw new Error("A note of up to 5,000 characters is required.");
  return {
    id: randomUUID(),
    capturedAt: now.toISOString(),
    source: "user-text",
    note: value,
    contextRelationshipId,
    status: "pending",
    summary: "",
    people: [],
    sharedDetails: [],
    householdDetails: [],
    connections: [],
    otherPeople: [],
    commitments: [],
  };
}

export function newImageCaptureEvent(
  input: { note: string; sourceText: string; visualDetails: string },
  contextRelationshipId: string | null,
  now = new Date(),
): CaptureEvent {
  const note = input.note.trim();
  const sourceText = input.sourceText.trim();
  const visualDetails = input.visualDetails.trim();
  if (note.length > 1_500 || sourceText.length > 8_000 || visualDetails.length > 1_500 ||
    (!sourceText && !visualDetails)) {
    throw new Error("The photo did not yield usable information within the capture limits.");
  }
  return {
    id: randomUUID(),
    capturedAt: now.toISOString(),
    source: "user-image",
    note,
    sourceText,
    visualDetails,
    contextRelationshipId,
    status: "pending",
    summary: "",
    people: [],
    sharedDetails: [],
    householdDetails: [],
    connections: [],
    otherPeople: [],
    commitments: [],
  };
}

export function captureInterpretationText(event: CaptureEvent) {
  if (event.source !== "user-image") return event.note;
  return [
    event.note && "User-provided context (not printed on the image):\n" + event.note,
    event.sourceText && "Text read from the selected photo:\n" + event.sourceText,
    event.visualDetails && "Visible non-text details (model observations, not verified identities):\n" + event.visualDetails,
  ].filter(Boolean).join("\n\n");
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchingName(recordLabel: string, name: string) {
  const a = normalized(recordLabel);
  const b = normalized(name);
  if (!a || !b) return false;
  return a === b ||
    (b.split(" ").length === 1 && a.split(" ")[0] === b) ||
    (a.split(" ").length === 1 && b.split(" ")[0] === a);
}

function capturedSource(event: CaptureEvent): RelationshipSource {
  return {
    id: "capture:" + event.id,
    source: "capture",
    observedAt: event.capturedAt.slice(0, 10),
    label: event.source === "user-image" ? "Photo you chose (image not retained)" : "Your saved note",
  };
}

function createProvisional(name: string, now: Date, sourceKind: CaptureEvent["source"]): RelationshipRecord {
  const record = createManualRelationshipRecord(name, undefined, undefined, now);
  return {
    ...record,
    personLabelAuthority: "inferred-unverified",
    labelAuthority: "inferred-only",
    sources: [],
    history: {
      earliestObservedMeaningfulInteraction: "",
      latestObservedMeaningfulInteraction: "",
      pattern: sourceKind === "user-image"
        ? "Started from a photo the user chose to capture; other history is not yet known."
        : "Started from a user-authored note; other history is not yet known.",
      evidenceIds: [],
    },
    unknowns: [],
  };
}

function participantFacts(person: CaptureParticipant): CaptureFact[] {
  const fields: CaptureFact[] = [
    { category: "Work", label: "Company", value: person.company },
    { category: "Work", label: "Role", value: person.jobTitle },
    { category: "Location", label: "City", value: person.city },
    { category: "Personal", label: "Phone", value: person.phone },
    { category: "Personal", label: "LinkedIn", value: person.linkedin },
  ];
  return [...fields, ...person.facts].filter((fact) => fact.label.trim() && fact.value.trim());
}

function resolvedIdForName(people: CapturedPerson[], name: string): string | null {
  const matches = people.filter((person) => normalized(person.name) === normalized(name) && person.relationshipId);
  // Never resolve an edge to one of several people who share the same name.
  return matches.length === 1 ? matches[0].relationshipId : null;
}

function resolvedConnections(connections: CapturedConnection[], people: CapturedPerson[]): CapturedConnection[] {
  return connections.map((connection) => ({
    ...connection,
    firstRelationshipId: resolvedIdForName(people, connection.firstName),
    secondRelationshipId: resolvedIdForName(people, connection.secondName),
  }));
}

function addParticipantMemory(
  record: RelationshipRecord,
  person: CaptureParticipant,
  source: RelationshipSource,
  now: Date,
): RelationshipRecord {
  const durableFacts = [...record.durableFacts];
  for (const fact of participantFacts(person)) {
    const index = durableFacts.findIndex((item) =>
      normalized(item.label) === normalized(fact.label) && normalized(item.value) === normalized(fact.value),
    );
    if (index < 0) {
      durableFacts.push({
        ...fact,
        id: randomUUID(),
        sourceIds: [source.id],
        firstObservedAt: source.observedAt,
        lastObservedAt: source.observedAt,
      });
    } else {
      const prior = durableFacts[index];
      durableFacts[index] = {
        ...prior,
        sourceIds: [...new Set([...prior.sourceIds, source.id])],
        lastObservedAt: source.observedAt > prior.lastObservedAt ? source.observedAt : prior.lastObservedAt,
      };
    }
  }

  const identities = record.identities.map((identity) => ({ ...identity, sourceIds: [...identity.sourceIds] }));
  if (person.email.trim()) {
    const email = normalized(person.email);
    const existing = identities.find((item) => item.kind === "email" && normalized(item.value) === email);
    if (existing) {
      existing.sourceIds = [...new Set([...existing.sourceIds, source.id])];
    } else {
      identities.push({
        id: randomUUID(),
        kind: "email",
        source: "capture",
        value: email,
        confirmed: false,
        label: source.label + " (unverified)",
        sourceIds: [source.id],
      });
    }
  }

  return {
    ...record,
    updatedAt: now.toISOString(),
    // Capture time is *not* an inferred meeting date. Do not alter lastInteractionAt.
    durableFacts,
    identities,
    history: {
      ...record.history,
      evidenceIds: [...new Set([...record.history.evidenceIds, source.id])],
    },
    sources: record.sources.some((item) => item.id === source.id) ? record.sources : [...record.sources, source],
  };
}

export function applyCaptureExtraction(
  event: CaptureEvent,
  extraction: CaptureExtraction,
  existing: RelationshipRecord[],
  now = new Date(),
) {
  if (event.status !== "pending") throw new Error("This note was already interpreted.");
  const source = capturedSource(event);
  const relationships = [...existing];
  const seenNames = new Set<string>();
  const people: CapturedPerson[] = [];

  for (const person of extraction.participants) {
    const name = person.name.trim();
    if (!name) continue;
    const nameKey = normalized(name);
    // A repeated or ambiguous participant label in one note is not a new identity.
    const repeated = seenNames.has(nameKey);
    seenNames.add(nameKey);
    const anchor = relationships.find((record) => record.id === event.contextRelationshipId);
    const anchorMatch = anchor && matchingName(anchor.personLabel, name) ? anchor : null;
    const emailMatches = person.email.trim()
      ? relationships.filter((record) => record.identities.some((identity) =>
        identity.kind === "email" && normalized(identity.value) === normalized(person.email),
      ))
      : [];
    const nameMatches = relationships.filter((record) => matchingName(record.personLabel, name));
    const candidates = [...new Set([...emailMatches, ...nameMatches].map((record) => record.id))];

    let chosen: RelationshipRecord | null = null;
    let resolution: CapturedPerson["resolution"] = "needs-review";
    if (!repeated && anchorMatch) {
      chosen = anchorMatch;
      resolution = "linked";
    } else if (!repeated && emailMatches.length === 1) {
      chosen = emailMatches[0];
      resolution = "linked";
    } else if (!repeated && candidates.length === 0) {
      chosen = createProvisional(name, now, event.source);
      relationships.push(chosen);
      resolution = "created";
    }

    if (chosen) {
      const index = relationships.findIndex((record) => record.id === chosen!.id);
      relationships[index] = addParticipantMemory(chosen, person, source, now);
    }
    people.push({
      ...person,
      name,
      resolution,
      relationshipId: chosen?.id ?? null,
      candidateIds: resolution === "needs-review" ? candidates : [],
    });
  }

  const connections: CapturedConnection[] = (extraction.connections ?? [])
    .filter((link) => normalized(link.firstName) !== normalized(link.secondName))
    .map((link) => ({
      ...link,
      id: randomUUID(),
      firstRelationshipId: null,
      secondRelationshipId: null,
      dismissed: false,
    }));

  return {
    event: {
      ...event,
      status: "interpreted" as const,
      summary: extraction.summary.trim(),
      people,
      sharedDetails: extraction.sharedDetails,
      householdDetails: extraction.householdDetails ?? [],
      connections: resolvedConnections(connections, people),
      otherPeople: extraction.otherPeople,
      commitments: extraction.commitments,
    },
    relationships,
  };
}

export function resolveCapturePerson(
  event: CaptureEvent,
  index: number,
  selectedId: string,
  existing: RelationshipRecord[],
  now = new Date(),
) {
  const person = event.people[index];
  if (!person || person.resolution !== "needs-review") throw new Error("No unresolved person at that position.");
  if (selectedId !== "new" && !person.candidateIds.includes(selectedId)) {
    throw new Error("The selected relationship was not offered for this person.");
  }
  const relationships = [...existing];
  let chosen = selectedId === "new" ? null : relationships.find((record) => record.id === selectedId) ?? null;
  if (selectedId !== "new" && !chosen) throw new Error("The selected relationship no longer exists.");
  const resolution: CapturedPerson["resolution"] = selectedId === "new" ? "created" : "linked";
  const source = capturedSource(event);
  if (!chosen) {
    chosen = createProvisional(person.name, now, event.source);
    relationships.push(chosen);
  }
  const position = relationships.findIndex((record) => record.id === chosen!.id);
  relationships[position] = addParticipantMemory(chosen, person, source, now);
  const updatedPeople = event.people.map((item, i) => i === index
    ? { ...item, relationshipId: chosen!.id, resolution, candidateIds: [] } : item);
  return {
    event: {
      ...event,
      people: updatedPeople,
      connections: resolvedConnections(event.connections ?? [], updatedPeople),
    },
    relationships,
  };
}

export function isCaptureForRelationship(event: CaptureEvent, relationshipId: string) {
  return event.contextRelationshipId === relationshipId || event.people.some((person) => person.relationshipId === relationshipId);
}

export function connectedPeopleFromCaptures(captures: CaptureEvent[], relationshipId: string) {
  const connections = captures.flatMap((event) => (event.connections ?? [])
    .filter((link) => !link.dismissed && link.firstRelationshipId && link.secondRelationshipId &&
      link.firstRelationshipId !== link.secondRelationshipId &&
      (link.firstRelationshipId === relationshipId || link.secondRelationshipId === relationshipId))
    .map((link) => ({
      event,
      link,
      relatedRelationshipId: link.firstRelationshipId === relationshipId
        ? link.secondRelationshipId! : link.firstRelationshipId!,
    })))
    .sort((a, b) => b.event.capturedAt.localeCompare(a.event.capturedAt));
  const seen = new Set<string>();
  return connections.filter(({ relatedRelationshipId, link }) => {
    const key = relatedRelationshipId + ":" + link.kind;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sharedHouseholdContextFromCaptures(captures: CaptureEvent[], relationshipId: string) {
  const householdLinks = captures.flatMap((event) => (event.connections ?? [])
    .filter((link) => link.kind === "household" && !link.dismissed &&
      link.firstRelationshipId && link.secondRelationshipId &&
      link.firstRelationshipId !== link.secondRelationshipId &&
      (link.firstRelationshipId === relationshipId || link.secondRelationshipId === relationshipId))
    .map((link) => ({
      memberId: link.firstRelationshipId === relationshipId
        ? link.secondRelationshipId! : link.firstRelationshipId!,
      linkedAt: event.capturedAt,
    })));
  const seen = new Set<string>();
  return captures.flatMap((event) => {
    if (event.status !== "interpreted" || !event.householdDetails?.length ||
      isCaptureForRelationship(event, relationshipId)) return [];
    return householdLinks.flatMap(({ memberId, linkedAt }) => {
      // Context before two people were known to share a household is not silently backfilled.
      if (event.capturedAt < linkedAt || !isCaptureForRelationship(event, memberId)) return [];
      return event.householdDetails!.flatMap((detail) => {
        const key = event.id + ":" + detail;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ event, detail, viaRelationshipId: memberId }];
      });
    });
  }).sort((a, b) => b.event.capturedAt.localeCompare(a.event.capturedAt));
}

export function dismissCapturedConnection(event: CaptureEvent, connectionId: string, relationshipId: string) {
  const target = (event.connections ?? []).find((link) => link.id === connectionId &&
    (link.firstRelationshipId === relationshipId || link.secondRelationshipId === relationshipId));
  if (!target || target.dismissed) throw new Error("Connected-person suggestion not found.");
  return {
    ...event,
    connections: (event.connections ?? []).map((link) => link.id === connectionId ? { ...link, dismissed: true } : link),
  };
}
