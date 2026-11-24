import { describe, expect, it } from "vitest";
import {
  correctActionableMemory, createManualRelationshipRecord,
  mergeInteractionIntoRelationship, type InteractionExtraction,
} from "./relationship-record";
import { buildConnectionCandidates } from "./connection-subjects";
import { selectHomeAttention } from "./home-attention";

const source = {
  id: "fictional-call:1", source: "transcript" as const,
  observedAt: "2026-11-20", label: "Fictional call",
};
const loop = { commitment: "Find a local 5K for Judy.", owner: "Jason", status: "Open" as const };
const future = { reason: "Discuss Judy's first race.", trigger: "When she registers for one." };
const emptyExtraction: InteractionExtraction = {
  summary: "Fictional catch-up", relationshipContexts: [], relationshipRoles: [], tags: [],
  durableFacts: [], activeThreads: [], openLoops: [], stewardshipOpportunities: [], unknowns: [],
};
function seed() {
  const record = createManualRelationshipRecord("Fictional Judy");
  return mergeInteractionIntoRelationship(record, {
    ...emptyExtraction, openLoops: [loop], stewardshipOpportunities: [future],
  }, source);
}
function from(sourceId: string, date = "2026-11-21") {
  return { ...source, id: sourceId, observedAt: date };
}

describe("source-aware actionable memory correction", () => {
  it("records Done with original evidence, removes active Home attention, and blocks same-evidence replay", () => {
    const saved = seed();
    expect(selectHomeAttention([saved], "Jason").commitments).toHaveLength(1);
    const completed = correctActionableMemory(saved, {
      kind: "open-loop", commitment: " find a local 5k for judy. ", owner: "jason",
    }, "Done", {}, new Date("2026-11-24T10:00:00Z"));
    expect(completed.openLoops).toEqual([]);
    expect(completed.stewardshipOpportunities).toHaveLength(1);
    expect(completed.actionableMemoryFeedback?.[0]).toMatchObject({
      disposition: "Done", originalText: loop.commitment, originalContext: "Jason",
      sourceIds: [source.id], decidedAt: "2026-11-24T10:00:00.000Z",
    });
    expect(selectHomeAttention([completed], "Jason").commitments).toEqual([]);
    const replayed = mergeInteractionIntoRelationship(completed, {
      ...emptyExtraction, openLoops: [loop],
    }, source);
    expect(replayed.openLoops).toEqual([]);
    expect(buildConnectionCandidates(replayed, "Jason").some((x) => x.kind === "commitment")).toBe(false);
    const newer = mergeInteractionIntoRelationship(replayed, {
      ...emptyExtraction, openLoops: [loop],
    }, from("fictional-call:new", "2027-03-01"));
    expect(newer.openLoops).toHaveLength(1);
    expect(newer.openLoops[0].sourceIds).toEqual(["fictional-call:new"]);
  });

  it("keeps Incorrect blocked from both old and new extracted source evidence", () => {
    const retired = correctActionableMemory(seed(), {
      kind: "open-loop", commitment: loop.commitment, owner: loop.owner,
    }, "Incorrect");
    const rerun = mergeInteractionIntoRelationship(retired, {
      ...emptyExtraction, openLoops: [loop, {
        commitment: "Judy will send a training schedule.", owner: "Judy", status: "Open",
      }],
    }, from("fictional-call:2"));
    expect(rerun.openLoops.map((x) => x.commitment)).toEqual([
      "Judy will send a training schedule.",
    ]);
    expect(rerun.actionableMemoryFeedback?.[0].disposition).toBe("Incorrect");
  });

  it("retains unrelated future triggers when one is dismissed as Not relevant", () => {
    const original = seed();
    const retired = correctActionableMemory(original,
      { kind: "opportunity", id: original.stewardshipOpportunities[0].id }, "Not relevant");
    expect(retired.stewardshipOpportunities).toEqual([]);
    const newer = mergeInteractionIntoRelationship(retired, {
      ...emptyExtraction,
      stewardshipOpportunities: [
        { reason: " DISCUSS judy's first race. ", trigger: "When she registers for one." },
        { reason: "Ask about a book she's reading.", trigger: "After she finishes it." },
      ],
    }, from("fictional-call:later"));
    expect(newer.stewardshipOpportunities.map((x) => x.reason)).toEqual([
      "Ask about a book she's reading.",
    ]);
  });

  it("replaces a false open commitment with a user-confirmed version immune to AI re-ingestion", () => {
    const original = seed();
    const fixed = correctActionableMemory(original, {
      kind: "open-loop", commitment: loop.commitment, owner: loop.owner,
    }, "Edit", {
      text: "Find running groups for Judy if she wants suggestions.", context: "Judy",
    }, new Date("2026-11-24T10:00:00Z"));
    expect(fixed.openLoops).toMatchObject([{
      commitment: "Find running groups for Judy if she wants suggestions.",
      owner: "Judy", status: "Open", userConfirmed: true,
    }]);
    const correctionSource = fixed.sources.find((x) => x.id === fixed.openLoops[0].sourceIds[0]);
    expect(correctionSource?.label).toBe("User-confirmed memory correction");
    expect(fixed.actionableMemoryFeedback?.[0]).toMatchObject({
      disposition: "Edit", replacement: {
        text: "Find running groups for Judy if she wants suggestions.", context: "Judy",
      }, sourceIds: [source.id],
    });
    const replayed = mergeInteractionIntoRelationship(fixed, {
      ...emptyExtraction, openLoops: [loop],
    }, source);
    expect(replayed.openLoops.map((x) => x.commitment)).toEqual([
      "Find running groups for Judy if she wants suggestions.",
    ]);
    expect(replayed.openLoops[0].userConfirmed).toBe(true);
    expect(buildConnectionCandidates(replayed, "Jason").some((x) =>
      x.description.includes("Find a local 5K"))).toBe(false);
  });

  it("persists corrected future signals through unrelated new captures", () => {
    const original = seed();
    const fixed = correctActionableMemory(original, {
      kind: "opportunity", id: original.stewardshipOpportunities[0].id,
    }, "Edit", {
      text: "Ask how Judy's new running group is going.",
      context: "Only after she says she has joined.",
    });
    const result = mergeInteractionIntoRelationship(fixed, {
      ...emptyExtraction, stewardshipOpportunities: [future],
    }, from("fictional-call:2"));
    expect(result.stewardshipOpportunities).toHaveLength(1);
    expect(result.stewardshipOpportunities[0]).toMatchObject({
      reason: "Ask how Judy's new running group is going.",
      trigger: "Only after she says she has joined.",
      userConfirmed: true,
    });
  });

  it("allows revising an existing correction without losing its earlier audit record", () => {
    const first = correctActionableMemory(seed(), {
      kind: "open-loop", commitment: loop.commitment, owner: loop.owner,
    }, "Edit", { text: "Send two race links to Judy.", context: "Jason" });
    const second = correctActionableMemory(first, {
      kind: "open-loop", commitment: "Send two race links to Judy.", owner: "Jason",
    }, "Done");
    expect(second.openLoops).toEqual([]);
    expect(second.actionableMemoryFeedback?.map((x) => x.disposition)).toEqual(["Edit", "Done"]);
    expect(second.sources.some((x) => x.id.startsWith("manual-correction:"))).toBe(true);
  });

  it("validates targets, correction contents, and non-destructive decisions", () => {
    const record = seed();
    expect(() => correctActionableMemory(record, {
      kind: "open-loop", commitment: "Made-up commitment", owner: "Jason",
    }, "Incorrect")).toThrow(/not found/);
    expect(() => correctActionableMemory(record, {
      kind: "opportunity", id: "not-a-real-id",
    }, "Not relevant")).toThrow(/not found/);
    expect(() => correctActionableMemory(record, {
      kind: "open-loop", commitment: loop.commitment, owner: loop.owner,
    }, "Edit", { text: loop.commitment })).toThrow(/meaningful corrected/);
    expect(() => correctActionableMemory(record, {
      kind: "open-loop", commitment: loop.commitment, owner: loop.owner,
    }, "Edit", { text: "x".repeat(501) })).toThrow(/meaningful corrected/);
    expect(record.actionableMemoryFeedback).toEqual([]);
    expect(record.openLoops).toHaveLength(1);
  });

  it("reads old JSON records without any correction fields", () => {
    const old = seed();
    delete old.actionableMemoryFeedback;
    delete old.dismissedConnectionSubjects;
    const copied = JSON.parse(JSON.stringify(old)) as typeof old;
    const fixed = correctActionableMemory(copied, {
      kind: "open-loop", commitment: loop.commitment, owner: loop.owner,
    }, "Not relevant");
    expect(fixed.actionableMemoryFeedback).toHaveLength(1);
    expect(fixed.openLoops).toEqual([]);
  });
});
