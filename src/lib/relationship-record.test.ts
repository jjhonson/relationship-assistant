import { describe, expect, it } from "vitest";
import {
  createManualRelationshipRecord,
  mergeInteractionIntoRelationship,
  type InteractionExtraction,
} from "./relationship-record";

const extraction: InteractionExtraction = {
  summary: "A personal catch-up with several evolving life and work threads.",
  relationshipContexts: ["Personal relationship"],
  relationshipRoles: [],
  tags: ["guitar", "Pinecrest", "real estate"],
  durableFacts: [
    { category: "Family", label: "Wife", value: "Allison" },
    { category: "Family", label: "Son", value: "Austin" },
    { category: "Location", label: "Home area", value: "Pinecrest" },
    { category: "Interest", label: "Interest", value: "Guitar" },
  ],
  activeThreads: [
    {
      topic: "Pinecrest house renovation",
      state: "Permit received and renovation work is moving into execution.",
      whyItMatters: "The project followed a difficult contractor dispute and remains a major focus.",
      nextChangeSignal: "Meaningful construction progress or another project milestone.",
    },
    {
      topic: "Allison's store relocation",
      state: "Evaluating a consequential relocation and build-out.",
      whyItMatters: "Brand support could make the move highly successful or create material business risk.",
      nextChangeSignal: "Decision or feedback from key brands.",
    },
  ],
  openLoops: [],
  stewardshipOpportunities: [
    {
      reason: "The house renovation should have meaningful new progress later.",
      trigger: "When the project has had time to move beyond permitting.",
    },
  ],
  unknowns: ["No exact follow-up date was agreed."],
};

describe("relationship record interaction merge", () => {
  it("adds durable context, active threads, and stewardship opportunities without replacing user-confirmed relationship identity", () => {
    const record = createManualRelationshipRecord(
      "Matthew Strongin",
      "Former colleague",
      undefined,
      new Date("2026-11-01T12:00:00Z"),
    );

    const updated = mergeInteractionIntoRelationship(
      record,
      extraction,
      {
        id: "transcript:test",
        source: "transcript",
        observedAt: "2026-11-06",
        label: "Call transcript",
      },
      new Date("2026-11-10T12:00:00Z"),
    );

    expect(updated.relationshipContexts).toEqual(["Former colleague", "Personal relationship"]);
    expect(updated.classification).toBe("Professional contact");
    expect(updated.currentState).toBe("Active");
    expect(updated.lastInteractionAt).toBe("2026-11-06");
    expect(updated.durableFacts.map((fact) => fact.value)).toEqual([
      "Allison",
      "Austin",
      "Pinecrest",
      "Guitar",
    ]);
    expect(updated.activeThreads.map((thread) => thread.topic)).toEqual([
      "Pinecrest house renovation",
      "Allison's store relocation",
    ]);
    expect(updated.stewardshipOpportunities).toHaveLength(1);
    expect(updated.sources.map((source) => source.id)).toContain("transcript:test");
  });

  it("updates an existing active thread instead of duplicating it", () => {
    const record = createManualRelationshipRecord("Person A");
    const first = mergeInteractionIntoRelationship(
      record,
      extraction,
      {
        id: "transcript:first",
        source: "transcript",
        observedAt: "2026-11-06",
        label: "Call transcript",
      },
    );

    const secondExtraction: InteractionExtraction = {
      ...extraction,
      durableFacts: [],
      activeThreads: [{
        topic: "Pinecrest house renovation",
        state: "Demolition is complete and construction is underway.",
        whyItMatters: "The project has moved into a new phase.",
        nextChangeSignal: "Major construction milestone.",
      }],
      stewardshipOpportunities: [],
    };
    const second = mergeInteractionIntoRelationship(
      first,
      secondExtraction,
      {
        id: "transcript:second",
        source: "transcript",
        observedAt: "2027-01-10",
        label: "Call transcript",
      },
    );

    const houseThreads = second.activeThreads.filter(
      (thread) => thread.topic === "Pinecrest house renovation",
    );
    expect(houseThreads).toHaveLength(1);
    expect(houseThreads[0].state).toContain("construction is underway");
    expect(houseThreads[0].sourceIds).toEqual(["transcript:first", "transcript:second"]);
  });
});
