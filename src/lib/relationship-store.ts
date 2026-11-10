import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RelationshipRecord } from "./relationship-record";

type StoreFile = {
  version: 1;
  relationships: RelationshipRecord[];
};

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
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, relationships: [] };
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

export async function listRelationships() {
  const store = await readStore();
  return [...store.relationships].sort((a, b) => a.personLabel.localeCompare(b.personLabel));
}

export async function getRelationship(id: string) {
  const store = await readStore();
  return store.relationships.find((relationship) => relationship.id === id) ?? null;
}

export async function saveRelationship(record: RelationshipRecord) {
  const store = await readStore();
  const index = store.relationships.findIndex((relationship) => relationship.id === record.id);
  if (index >= 0) {
    store.relationships[index] = record;
  } else {
    store.relationships.push(record);
  }
  await writeStore(store);
  return record;
}
