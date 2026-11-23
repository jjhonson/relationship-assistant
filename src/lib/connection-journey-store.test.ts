import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createManualRelationshipRecord } from "./relationship-record";
import {
  getRelationship, listConnectionJourneys, saveConfirmedConnectionEvent,
  saveRelationship, startConnectionJourney, listRelationships,
} from "./relationship-store";

describe("private connection journey persistence", () => {
  const originalCwd = process.cwd();
  let testDir: string;
  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "ra-connection-"));
    process.chdir(testDir);
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true, force: true });
  });

  async function seedTom() {
    const tom = createManualRelationshipRecord("Fictional Tom");
    tom.sources.push({
      id: "s-guitar", source: "manual", observedAt: "2026-11-21", label: "User-entered fictional note",
    });
    tom.durableFacts.push({
      id: "guitar", category: "Interest", label: "Hobby",
      value: "Learning guitar", sourceIds: ["s-guitar"],
      firstObservedAt: "2026-11-21", lastObservedAt: "2026-11-21",
    });
    await saveRelationship(tom);
    return tom;
  }

  it("reads pre-existing v1 records and retains them while adding a connection", async () => {
    const tom = createManualRelationshipRecord("Fictional Tom");
    const dir = path.join(testDir, ".data");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "relationships.json"), JSON.stringify({
      version: 1, relationships: [tom], captures: [], moments: [],
    }));
    expect(await listConnectionJourneys(tom.id)).toEqual([]);
    const journal = await startConnectionJourney(tom.id, "Share a guitar lesson", "", "Jason");
    expect(journal.events).toEqual([]);
    const disk = JSON.parse(await readFile(path.join(dir, "relationships.json"), "utf8"));
    expect(disk.version).toBe(1);
    expect(disk.relationships).toEqual([tom]);
    expect(disk.captures).toEqual([]);
    expect(disk.moments).toEqual([]);
    expect(disk.connectionJourneys[0].id).toBe(journal.id);
  });

  it("records actual events, updates a sourced outcome atomically, and doesn't store source transcripts", async () => {
    const tom = await seedTom();
    const first = await startConnectionJourney(tom.id, "Share guitar exercise", "fact:guitar", "Jason");
    expect(first.basisSourceIds).toEqual(["s-guitar"]);
    const reused = await startConnectionJourney(tom.id, "Share the same exercise", "fact:guitar", "Jason");
    expect(reused.id).toBe(first.id);
    await saveConfirmedConnectionEvent(tom.id, first.id, {
      kind: "prepared", happenedOn: "2026-11-21", summary: "Drafted the note.", outcome: "",
    }, "2026-11-23");
    expect((await getRelationship(tom.id))?.lastInteractionAt).toBeNull();

    await saveConfirmedConnectionEvent(tom.id, first.id, {
      kind: "sent", happenedOn: "2026-11-22", summary: "Sent Tom a guitar resource.", outcome: "",
    }, "2026-11-23");
    expect((await getRelationship(tom.id))?.lastInteractionAt).toBe("2026-11-22");

    const returned = await saveConfirmedConnectionEvent(tom.id, first.id, {
      kind: "reply_received", happenedOn: "2026-11-23",
      summary: "Tom replied about learning guitar.",
      outcome: "Tom hopes to try an open mic eventually; no event is scheduled.",
    }, "2026-11-23");
    expect(returned.journey.events).toHaveLength(3);
    const updated = (await getRelationship(tom.id))!;
    expect(updated.lastInteractionAt).toBe("2026-11-23");
    const learned = updated.durableFacts.find((fact) => fact.label === "Connection outcome");
    expect(learned?.value).toContain("hopes");
    expect(learned?.sourceIds[0]).toBe("connection-event:" + returned.event.id);
    expect(updated.sources.find((s) => s.id === learned?.sourceIds[0])?.label)
      .toContain("User-confirmed");
    expect((await listRelationships())[0].id).toBe(tom.id);
    const disk = await readFile(path.join(testDir, ".data/relationships.json"), "utf8");
    expect(disk).not.toContain("Tom: ");
    expect(disk).not.toContain("Me: ");
    expect((await listConnectionJourneys(tom.id))[0].events).toHaveLength(3);
  });

  it("keeps schedule separate from occurrence and serializes concurrent updates", async () => {
    const tom = await seedTom();
    const journey = await startConnectionJourney(tom.id, "Coffee later", "", "Jason");
    await Promise.all([
      saveConfirmedConnectionEvent(tom.id, journey.id, {
        kind: "meeting_scheduled", happenedOn: "2026-11-23",
        summary: "Coffee booked for December 3.", outcome: "",
      }, "2026-11-23"),
      saveConfirmedConnectionEvent(tom.id, journey.id, {
        kind: "prepared", happenedOn: "2026-11-23",
        summary: "I prepared talking points.", outcome: "",
      }, "2026-11-23"),
    ]);
    expect((await listConnectionJourneys(tom.id))[0].events).toHaveLength(2);
    expect((await getRelationship(tom.id))?.lastInteractionAt).toBeNull();
    await expect(saveConfirmedConnectionEvent(tom.id, journey.id, {
      kind: "interaction_occurred", happenedOn: "2026-12-03",
      summary: "Coffee occurred in the future.", outcome: "",
    }, "2026-11-23")).rejects.toThrow(/date/i);
    expect((await listConnectionJourneys(tom.id))[0].events).toHaveLength(2);
  });

  it("rejects invalid suggestion bases and corrupt data without overwriting", async () => {
    const tom = await seedTom();
    await expect(startConnectionJourney(tom.id, "Send article", "fact:invented", "Jason"))
      .rejects.toThrow(/no longer supported/);
    const folder = path.join(testDir, ".data");
    const file = path.join(folder, "relationships.json");
    const disk = JSON.parse(await readFile(file, "utf8"));
    disk.connectionJourneys = "corrupted";
    await writeFile(file, JSON.stringify(disk));
    await expect(listConnectionJourneys(tom.id))
      .rejects.toThrow("Unsupported connection journal store format.");
    await expect(startConnectionJourney(tom.id, "Should not write", "", "Jason"))
      .rejects.toThrow("Unsupported connection journal store format.");
    expect(JSON.parse(await readFile(file, "utf8")).connectionJourneys).toBe("corrupted");
  });
});
