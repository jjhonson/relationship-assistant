import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createManualRelationshipRecord } from "./relationship-record";
import {
  getPersonalMoment,
  listPersonalMoments,
  listRelationships,
  saveNewCapture,
  savePersonalMoment,
  setPersonalMomentConsideration,
} from "./relationship-store";

describe("private local personal moment persistence", () => {
  const originalCwd = process.cwd();
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "ra-moments-"));
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true, force: true });
  });

  it("reads an older relationship database with no moments and adds a new moment without altering people", async () => {
    const existing = createManualRelationshipRecord("Fictional neighbor Tom");
    const folder = path.join(testDir, ".data");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "relationships.json"), JSON.stringify({
      version: 1, relationships: [existing], captures: [],
    }));
    expect(await listPersonalMoments()).toEqual([]);

    const moment = await savePersonalMoment({
      description: "Found a guitar exercise",
      reflection: "It explains a useful change between chords.",
      consideration: "consider-people",
    });
    expect((await getPersonalMoment(moment.id))?.reflection).toContain("between chords");

    const persisted = JSON.parse(await readFile(path.join(folder, "relationships.json"), "utf8"));
    expect(persisted.version).toBe(1);
    expect(persisted.relationships).toEqual([existing]);
    expect(persisted.captures).toEqual([]);
    expect(persisted.moments).toHaveLength(1);
    expect(persisted.moments[0].id).toBe(moment.id);
    expect((await stat(path.join(folder, "relationships.json"))).mode & 0o777).toBe(0o600);
    expect((await listRelationships()).map((p) => p.id)).toEqual([existing.id]);
  });

  it("allows private moments to become eligible and then private again without data loss", async () => {
    const moment = await savePersonalMoment({
      description: "A critical idea from a fictional book",
      reflection: "I disagree with the conclusion, but it raised a useful question.",
    });
    expect(moment.consideration).toBe("private");
    await setPersonalMomentConsideration(moment.id, "consider-people");
    expect((await getPersonalMoment(moment.id))?.consideration).toBe("consider-people");
    await setPersonalMomentConsideration(moment.id, "private");
    expect((await getPersonalMoment(moment.id))).toMatchObject({
      consideration: "private",
      description: moment.description,
      reflection: moment.reflection,
    });
    await expect(setPersonalMomentConsideration("nonexistent", "private")).rejects.toThrow("not found");
  });

  it("preserves existing moments when saving a separate person-specific note", async () => {
    const moment = await savePersonalMoment({ description: "A private personal idea" });
    const capture = await saveNewCapture("Met fictional Alex at a neighborhood event.");
    const stored = JSON.parse(await readFile(path.join(testDir, ".data/relationships.json"), "utf8"));
    expect(stored.moments).toHaveLength(1);
    expect(stored.moments[0].id).toBe(moment.id);
    expect(stored.captures[0].id).toBe(capture.id);
  });

  it("does not overwrite a corrupted moments field with an empty list", async () => {
    const folder = path.join(testDir, ".data");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "relationships.json"),
      JSON.stringify({ version: 1, relationships: [], captures: [], moments: "corrupted" }));
    await expect(listPersonalMoments()).rejects.toThrow("Unsupported personal moments store format");
    await expect(savePersonalMoment({ description: "Should not be saved" }))
      .rejects.toThrow("Unsupported personal moments store format");
    const unchanged = JSON.parse(await readFile(path.join(folder, "relationships.json"), "utf8"));
    expect(unchanged.moments).toBe("corrupted");
  });
});
