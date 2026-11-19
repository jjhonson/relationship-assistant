import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyCaptureExtraction,
  isCaptureForRelationship,
  newCaptureEvent,
  newImageCaptureEvent,
  resolveCapturePerson,
  type CaptureEvent,
  type CaptureExtraction,
} from "./capture";
import type { RelationshipIdentity, RelationshipRecord } from "./relationship-record";

type StoreFile = {
  version: 1;
  relationships: RelationshipRecord[];
  // Optional in older version-1 files. No destructive migration required.
  captures: CaptureEvent[];
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
        actionableMemoryFeedback: Array.isArray(relationship.actionableMemoryFeedback)
          ? relationship.actionableMemoryFeedback : [],
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, relationships: [], captures: [] };
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
