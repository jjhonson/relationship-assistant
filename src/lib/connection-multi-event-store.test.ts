import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createManualRelationshipRecord } from "./relationship-record";
import {
  getRelationship, listConnectionJourneys, saveConfirmedConnectionEvent,
  saveConfirmedConnectionEvents, saveRelationship, startConnectionJourney,
} from "./relationship-store";

describe("atomic multi-event connection persistence", () => {
  const originalCwd = process.cwd();
  let temp: string;
  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), "ra-connection-batch-"));
    process.chdir(temp);
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(temp, { recursive: true, force: true });
  });
  async function setup() {
    const tom = createManualRelationshipRecord("Fictional Tom");
    await saveRelationship(tom);
    const journey = await startConnectionJourney(tom.id, "Guitar article", "", "Jason");
    return { tom, journey };
  }
  const id1 = "c457bf12-497e-41a2-adbc-2cc8d0dff001";
  const id2 = "c457bf12-497e-41a2-adbc-2cc8d0dff002";
  const sent = {
    kind: "sent" as const, happenedOn: "2026-11-22",
    summary: "I sent Tom the guitar article.", outcome: "",
  };
  const reply = {
    kind: "reply_received" as const, happenedOn: "2026-11-23",
    summary: "Tom replied about the guitar article.",
    outcome: "Tom hopes to play at an open mic someday, but nothing is scheduled.",
  };
  async function disk() {
    return JSON.parse(await readFile(path.join(temp, ".data/relationships.json"), "utf8"));
  }

  it("writes two confirmed events and source-backed learning in one operation", async () => {
    const { tom, journey } = await setup();
    const result = await saveConfirmedConnectionEvents(
      tom.id, journey.id, [sent, reply], "2026-11-23", id1,
    );
    expect(result.duplicate).toBe(false);
    expect(result.events.map((x) => x.kind)).toEqual(["sent", "reply_received"]);
    expect(result.events.map((x) => x.confirmationId)).toEqual([id1, id1]);
    const records = await listConnectionJourneys(tom.id);
    expect(records[0].events.map((x) => x.id)).toEqual(result.events.map((x) => x.id));
    const updated = (await getRelationship(tom.id))!;
    expect(updated.lastInteractionAt).toBe("2026-11-23");
    const learned = updated.durableFacts.find((x) => x.label === "Connection outcome");
    expect(learned?.value).toContain("hopes");
    expect(learned?.value).toContain("nothing is scheduled");
    expect(learned?.sourceIds).toEqual(["connection-event:" + result.events[1].id]);
    expect(updated.sources.find((x) => x.id === learned?.sourceIds[0])?.label)
      .toContain("not externally verified");
    const raw = await readFile(path.join(temp, ".data/relationships.json"), "utf8");
    expect(raw).not.toContain("Tom:");
    expect(raw).not.toContain("Me:");
    expect(raw).not.toContain("source transcript");
  });

  it("makes network retries idempotent, including learned facts", async () => {
    const { tom, journey } = await setup();
    const first = await saveConfirmedConnectionEvents(tom.id, journey.id, [sent, reply], "2026-11-23", id1);
    const second = await saveConfirmedConnectionEvents(tom.id, journey.id, [sent, reply], "2026-11-23", id1);
    expect(second.duplicate).toBe(true);
    expect(second.events.map((x) => x.id)).toEqual(first.events.map((x) => x.id));
    expect((await listConnectionJourneys(tom.id))[0].events).toHaveLength(2);
    expect((await getRelationship(tom.id))!.durableFacts.filter((x) => x.label === "Connection outcome"))
      .toHaveLength(1);
    await expect(saveConfirmedConnectionEvents(
      tom.id, journey.id, [{ ...sent, summary: "Different text." }, reply], "2026-11-23", id1,
    )).rejects.toThrow(/different update/);
  });

  it("does not partially save a valid send followed by a future-dated reply", async () => {
    const { tom, journey } = await setup();
    const before = await disk();
    await expect(saveConfirmedConnectionEvents(tom.id, journey.id, [
      sent, { ...reply, happenedOn: "2026-12-12" },
    ], "2026-11-23", id1)).rejects.toThrow(/date/i);
    expect(await disk()).toEqual(before);
    expect((await listConnectionJourneys(tom.id))[0].events).toEqual([]);
  });

  it("does not learn outcomes from mere drafting or scheduling", async () => {
    const { tom, journey } = await setup();
    await expect(saveConfirmedConnectionEvents(tom.id, journey.id, [
      { ...sent, kind: "prepared", outcome: "Tom signed up." },
    ], "2026-11-23", id1)).rejects.toThrow(/outcome/i);
    const schedule = await saveConfirmedConnectionEvents(tom.id, journey.id, [{
      kind: "meeting_scheduled", happenedOn: "2026-11-23",
      summary: "Scheduled coffee for December 3.", outcome: "",
    }], "2026-11-23", id1);
    expect(schedule.events).toHaveLength(1);
    expect((await getRelationship(tom.id))?.lastInteractionAt).toBeNull();
    expect((await getRelationship(tom.id))?.durableFacts).toHaveLength(0);
  });

  it("preserves earlier single-event timelines and private file schema", async () => {
    const { tom, journey } = await setup();
    const legacy = await saveConfirmedConnectionEvent(tom.id, journey.id, {
      kind: "prepared", happenedOn: "2026-11-21", summary: "Prepared a draft.", outcome: "",
    }, "2026-11-23");
    expect(legacy.event.kind).toBe("prepared");
    const batch = await saveConfirmedConnectionEvents(tom.id, journey.id, [sent, reply], "2026-11-23", id2);
    expect(batch.journey.events.map((x) => x.kind)).toEqual(["prepared", "sent", "reply_received"]);
    const file = await disk();
    expect(file.version).toBe(1);
    expect(file.connectionJourneys[0].events[0].id).toBe(legacy.event.id);
  });

  it("handles overlapping confirmed operations via serialized writes", async () => {
    const { tom, journey } = await setup();
    await Promise.all([
      saveConfirmedConnectionEvents(tom.id, journey.id, [sent], "2026-11-23", id1),
      saveConfirmedConnectionEvents(tom.id, journey.id, [reply], "2026-11-23", id2),
    ]);
    expect((await listConnectionJourneys(tom.id))[0].events).toHaveLength(2);
    expect((await getRelationship(tom.id))?.durableFacts.filter((x) => x.label === "Connection outcome"))
      .toHaveLength(1);
  });

  it("rejects pasted material and invalid confirmation IDs before mutation", async () => {
    const { tom, journey } = await setup();
    await expect(saveConfirmedConnectionEvents(tom.id, journey.id, [{
      kind: "reply_received", happenedOn: "2026-11-23",
      summary: "Tom: Hi.\nMe: Hello.", outcome: "",
    }], "2026-11-23", id1)).rejects.toThrow(/pasted/);
    await expect(saveConfirmedConnectionEvents(tom.id, journey.id, [sent],
      "2026-11-23", "bad-token")).rejects.toThrow(/confirmation ID/);
    expect((await listConnectionJourneys(tom.id))[0].events).toHaveLength(0);
  });

  it("reads older JSON files that lack confirmation IDs", async () => {
    const tom = createManualRelationshipRecord("Fictional Tom");
    const journey = {
      id: "legacy-journey", relationshipId: tom.id, subject: "Old connection",
      basisId: "", basisSourceIds: [], startedAt: "2026-11-20",
      events: [{ id: "old-event", kind: "sent", happenedOn: "2026-11-20",
        summary: "A note was sent.", outcome: "", recordedAt: "2026-11-20" }],
    };
    const folder = path.join(temp, ".data");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "relationships.json"), JSON.stringify({
      version: 1, relationships: [tom], captures: [], moments: [], connectionJourneys: [journey],
    }));
    expect((await listConnectionJourneys(tom.id))[0].events[0]).toMatchObject({ id: "old-event" });
    const result = await saveConfirmedConnectionEvents(tom.id, journey.id, [reply], "2026-11-23", id1);
    expect(result.journey.events).toHaveLength(2);
    expect((await disk()).connectionJourneys[0].events[0]).toEqual(journey.events[0]);
  });
});
