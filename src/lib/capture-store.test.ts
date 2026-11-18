import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getCapture,
  listCapturesForRelationship,
  listRecentCaptures,
  listRelationships,
  saveCaptureInterpretation,
  saveCapturePersonResolution,
  saveNewCapture,
  saveNewImageCapture,
  saveRelationship,
} from "./relationship-store";
import { createManualRelationshipRecord } from "./relationship-record";
import type { CaptureExtraction } from "./capture";

const blankParticipant = {
  name: "Tom", email: "", phone: "", company: "", jobTitle: "", city: "", linkedin: "", facts: [],
};
const extraction: CaptureExtraction = {
  summary: "Met a new neighbor.", participants: [blankParticipant],
  sharedDetails: ["Dog is named Pepper."], otherPeople: [], commitments: [],
};

describe("local quick capture persistence", () => {
  const oldCwd = process.cwd();
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "ra-capture-"));
    process.chdir(testDir);
  });
  afterEach(async () => {
    process.chdir(oldCwd);
    await rm(testDir, { recursive: true, force: true });
  });

  it("persists original user text before inference and keeps it when no interpretation occurs", async () => {
    const saved = await saveNewCapture("Met Tom at the fence.");
    const onDisk = JSON.parse(await readFile(path.join(testDir, ".data/relationships.json"), "utf8"));
    expect(onDisk.version).toBe(1);
    expect(onDisk.captures).toHaveLength(1);
    expect(onDisk.captures[0]).toMatchObject({ id: saved.id, note: "Met Tom at the fence.", status: "pending" });
    expect((await stat(path.join(testDir, ".data/relationships.json"))).mode & 0o777).toBe(0o600);
    expect(await getCapture(saved.id)).toMatchObject({ status: "pending" });
    expect(await listRecentCaptures()).toHaveLength(1);
  });

  it("saves only transcribed image evidence and user context, never raw image bytes", async () => {
    const saved = await saveNewImageCapture({
      note: "From my friend Arvin",
      sourceText: "Happy Diwali!\nArvin and Cindy",
      visualDetails: "A white dog is in the picture.",
    });
    const disk = await readFile(path.join(testDir, ".data/relationships.json"), "utf8");
    expect(disk).toContain('"source": "user-image"');
    expect(disk).toContain('"sourceText": "Happy Diwali!\\nArvin and Cindy"');
    expect(disk).not.toContain("data:image/");
    expect(await getCapture(saved.id)).toMatchObject({ status: "pending", note: "From my friend Arvin" });
    await saveCaptureInterpretation(saved.id, {
      ...extraction, participants: [{ ...blankParticipant, name: "Arvin" }],
      otherPeople: [{ name: "Cindy", connection: "Named as a signer" }],
    });
    expect((await listRelationships()).map((person) => person.personLabel)).toEqual(["Arvin"]);
  });

  it("saves linked people and encounter atomically when extraction succeeds", async () => {
    const saved = await saveNewCapture("Met Tom and Judy at the fence. Their dog is Pepper.");
    const interpreted = await saveCaptureInterpretation(saved.id, {
      ...extraction,
      participants: [blankParticipant, { ...blankParticipant, name: "Judy" }],
    });
    const records = await listRelationships();
    expect(interpreted.status).toBe("interpreted");
    expect(records).toHaveLength(2);
    expect(await listCapturesForRelationship(records[0].id)).toHaveLength(1);
    expect(await listCapturesForRelationship(records[1].id)).toHaveLength(1);
    const disk = JSON.parse(await readFile(path.join(testDir, ".data/relationships.json"), "utf8"));
    expect(disk.captures[0].people.map((person: { relationshipId: string }) => person.relationshipId).sort())
      .toEqual(disk.relationships.map((record: { id: string }) => record.id).sort());
    await expect(saveCaptureInterpretation(saved.id, extraction)).rejects.toThrow("already interpreted");
  });

  it("preserves an ambiguous encounter without making a duplicate and resolves on user choice", async () => {
    const existing = createManualRelationshipRecord("Tom Wilson");
    await saveRelationship(existing);
    const saved = await saveNewCapture("Met Tom at the fence.");
    const interpreted = await saveCaptureInterpretation(saved.id, extraction);
    expect((await listRelationships())).toHaveLength(1);
    expect(interpreted.people[0].resolution).toBe("needs-review");
    expect(interpreted.people[0].candidateIds).toEqual([existing.id]);
    await saveCapturePersonResolution(saved.id, 0, existing.id);
    expect((await listRelationships())).toHaveLength(1);
    expect((await getCapture(saved.id))?.people[0].resolution).toBe("linked");
  });

  it("keeps existing local relationship files readable when captures did not exist yet", async () => {
    const old = createManualRelationshipRecord("Existing Example");
    const dataDir = path.join(testDir, ".data");
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, "relationships.json"), JSON.stringify({ version: 1, relationships: [old] }));
    const records = await listRelationships();
    expect(records).toHaveLength(1);
    expect(await listRecentCaptures()).toEqual([]);
    const saved = await saveNewCapture("A note about the existing person", old.id);
    expect((await listCapturesForRelationship(old.id))[0].id).toBe(saved.id);
  });
});
