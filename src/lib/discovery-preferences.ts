import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type DiscoveryExclusionReason =
  | "self"
  | "close-family"
  | "not-person"
  | "out-of-scope";

export type DiscoveryExclusion = {
  kind: "email";
  value: string;
  source: "gmail";
  reason: DiscoveryExclusionReason;
  createdAt: string;
};

type PreferencesFile = {
  version: 1;
  exclusions: DiscoveryExclusion[];
};

function preferencesPath() {
  const root = path.join(process.cwd(), ".data");
  return {
    root,
    file: path.join(root, "discovery-preferences.json"),
  };
}

async function readPreferences(): Promise<PreferencesFile> {
  const target = preferencesPath();
  try {
    const raw = await readFile(/* turbopackIgnore: true */ target.file, "utf8");
    const parsed = JSON.parse(raw) as PreferencesFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.exclusions)) {
      throw new Error("Unsupported discovery preferences format.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, exclusions: [] };
    }
    throw error;
  }
}

async function writePreferences(preferences: PreferencesFile) {
  const target = preferencesPath();
  await mkdir(target.root, { recursive: true, mode: 0o700 });
  const temporary = target.file + ".tmp";
  await writeFile(temporary, JSON.stringify(preferences, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target.file);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function listDiscoveryExclusions() {
  const preferences = await readPreferences();
  return preferences.exclusions;
}

export async function saveDiscoveryExclusion(
  value: string,
  reason: DiscoveryExclusionReason,
) {
  const normalized = normalizeEmail(value);
  const preferences = await readPreferences();
  const existing = preferences.exclusions.findIndex(
    (item) => item.source === "gmail" && item.kind === "email" && item.value === normalized,
  );
  const exclusion: DiscoveryExclusion = {
    kind: "email",
    value: normalized,
    source: "gmail",
    reason,
    createdAt: new Date().toISOString(),
  };

  if (existing >= 0) preferences.exclusions[existing] = exclusion;
  else preferences.exclusions.push(exclusion);

  await writePreferences(preferences);
  return exclusion;
}

export async function removeDiscoveryExclusion(value: string) {
  const normalized = normalizeEmail(value);
  const preferences = await readPreferences();
  preferences.exclusions = preferences.exclusions.filter(
    (item) => !(item.source === "gmail" && item.kind === "email" && item.value === normalized),
  );
  await writePreferences(preferences);
}
