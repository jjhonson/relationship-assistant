import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createManualRelationshipRecord } from "./relationship-record";
import {
  correctSavedActionableMemory, dismissSavedConnectionSuggestion,
  getRelationship, listRelationships, saveRelationship,
} from "./relationship-store";
import { buildConnectionCandidates, reviewConnectionSubjects } from "./connection-subjects";
import { selectHomeAttention } from "./home-attention";

describe("persistent corrective memory actions on private JSON", () => {
  const cwd = process.cwd();
  let temp: string;
  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), "ra-memory-correction-"));
    process.chdir(temp);
  });
  afterEach(async () => {
    process.chdir(cwd);
    await rm(temp, { recursive: true, force: true });
  });
  const source = {
    id: "fictional-note:1", source: "capture" as const,
    observedAt: "2026-11-20", label: "Synthetic fictional capture",
  };
  function seed() {
    const record = createManualRelationshipRecord("Fictional Judy");
    record.sources.push(source);
    record.openLoops.push({
      commitment: "Send Judy a race list.", owner: "Jason", status: "Open",
      sourceIds: [source.id],
    });
    record.stewardshipOpportunities.push({
      id: "future:1", reason: "Ask if Judy joined a running group.",
      trigger: "After she confirms she joined.", sourceIds: [source.id],
      observedAt: "2026-11-20",
    });
    record.durableFacts.push({
      id: "fact:running", category: "Interest", label: "Exercise",
      value: "Considering a local running group", sourceIds: [source.id],
      firstObservedAt: "2026-11-20", lastObservedAt: "2026-11-20",
    });
    return record;
  }
  async function onDisk() {
    return JSON.parse(await readFile(path.join(temp, ".data/relationships.json"), "utf8"));
  }

  it("survives a reload and stops resurfacing completed promises on Home and candidate review", async () => {
    const person = seed();
    await saveRelationship(person);
    expect(selectHomeAttention(await listRelationships(), "Jason").commitments).toHaveLength(1);
    await correctSavedActionableMemory(person.id, {
      kind: "open-loop", commitment: "send judy a race list.", owner: "jason",
    }, "Done");
    const saved = (await getRelationship(person.id))!;
    expect(saved.actionableMemoryFeedback?.[0].disposition).toBe("Done");
    expect(saved.openLoops).toEqual([]);
    expect(selectHomeAttention(await listRelationships(), "Jason").commitments).toEqual([]);
    expect(buildConnectionCandidates(saved, "Jason").every((item) =>
      item.kind !== "commitment")).toBe(true);
    const disk = await onDisk();
    expect(disk.version).toBe(1);
    expect(disk.relationships[0].sources).toContainEqual(source);
  });

  it("creates a user-confirmed correction while retaining untouched people, moments, and capture data", async () => {
    const person = seed();
    const sibling = createManualRelationshipRecord("Other fictional contact");
    const folder = path.join(temp, ".data");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "relationships.json"), JSON.stringify({
      version: 1, relationships: [person, sibling], captures: [
        { id: "fictional-capture", note: "Fictional source note" },
      ], moments: [{ id: "private-moment", description: "Reading a fictional book" }],
      connectionJourneys: [{
        id: "existing-connection", relationshipId: person.id, subject: "A running article",
        basisId: "", basisSourceIds: [], startedAt: "2026-11-20", events: [],
      }],
    }));
    await correctSavedActionableMemory(person.id, {
      kind: "open-loop", commitment: "Send Judy a race list.", owner: "Jason",
    }, "Edit", { text: "Ask Judy if she wants suggestions for training groups.", context: "Jason" });
    const disk = await onDisk();
    expect(disk.relationships).toHaveLength(2);
    expect(disk.relationships[1]).toEqual(sibling);
    expect(disk.moments).toHaveLength(1);
    expect(disk.captures).toHaveLength(1);
    expect(disk.connectionJourneys).toHaveLength(1);
    expect(disk.relationships[0].openLoops[0].userConfirmed).toBe(true);
    expect(disk.relationships[0].actionableMemoryFeedback[0].sourceIds).toEqual([source.id]);
    expect(disk.relationships[0].sources.some((x: { id: string }) =>
      x.id.startsWith("manual-correction:"))).toBe(true);
  });

  it("removes only a selected future trigger, never unrelated relationship context", async () => {
    const person = seed();
    await saveRelationship(person);
    await correctSavedActionableMemory(person.id, {
      kind: "opportunity", id: "future:1",
    }, "Incorrect");
    const saved = (await getRelationship(person.id))!;
    expect(saved.stewardshipOpportunities).toEqual([]);
    expect(saved.openLoops).toHaveLength(1);
    expect(saved.durableFacts).toHaveLength(1);
    expect(saved.actionableMemoryFeedback?.[0]).toMatchObject({
      originalText: "Ask if Judy joined a running group.", disposition: "Incorrect",
    });
  });

  it("a suggestion dismissal persists without invalidating its supporting interest", async () => {
    const person = seed();
    await saveRelationship(person);
    const before = buildConnectionCandidates(person, "Jason");
    const candidate = before.find((x) => x.id === "fact:fact:running")!;
    expect(candidate).toBeTruthy();
    await dismissSavedConnectionSuggestion(person.id, candidate.id, "Jason");
    const updated = (await getRelationship(person.id))!;
    expect(updated.durableFacts).toEqual(person.durableFacts);
    expect(buildConnectionCandidates(updated, "Jason").some((x) => x.id === candidate.id)).toBe(false);
    expect(updated.dismissedConnectionSubjects?.[0]).toMatchObject({
      kind: "fact", sourceIds: [source.id],
    });
    const noMore = await reviewConnectionSubjects(updated, {
      apiKey: "", reviewedAt: "2026-11-24", userLabel: "Jason",
      excludedBasisIds: before.filter((x) => x.id !== candidate.id).map((x) => x.id),
      fetchImpl: async () => { throw new Error("No model call should occur"); },
    });
    expect(noMore.kind).toBe("no-suggestion");
    // A genuinely new source, not yet rejected by the user, reopens relevance.
    updated.durableFacts[0].sourceIds.push("new:trusted");
    updated.sources.push({ id: "new:trusted", source: "manual", label: "New observation", observedAt: "2027-01-01" });
    expect(buildConnectionCandidates(updated, "Jason").some((x) => x.id === candidate.id)).toBe(true);
  });

  it("rejects fabricated corrections and nonexistent suggestions without altering persistent data", async () => {
    const person = seed();
    await saveRelationship(person);
    const original = await onDisk();
    await expect(correctSavedActionableMemory(person.id, {
      kind: "open-loop", commitment: "Invented task", owner: "Jason",
    }, "Done")).rejects.toThrow(/not found/);
    await expect(dismissSavedConnectionSuggestion(person.id, "fact:not-found", "Jason"))
      .rejects.toThrow(/no longer available/);
    expect(await onDisk()).toEqual(original);
  });
});
