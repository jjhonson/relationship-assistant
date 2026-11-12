import { describe, expect, it } from "vitest";
import {
  createDiscoveredRelationshipRecord,
  createManualRelationshipRecord,
  mergeInteractionIntoRelationship,
  replaceRelationshipLabels,
  type InteractionExtraction,
} from "./relationship-record";

const extraction: InteractionExtraction = {
  summary: "A personal catch-up with several evolving life and work threads.",
  relationshipContexts: ["Personal relationship"],
  relationshipRoles: [],
  tags: ["guitar", "Pinecrest", "real estate"],
  durableFacts: [
    { existingFactId: "", category: "Family", label: "Wife", value: "Allison" },
    { existingFactId: "", category: "Family", label: "Son", value: "Austin" },
    { existingFactId: "", category: "Location", label: "Home area", value: "Pinecrest" },
    { existingFactId: "", category: "Interest", label: "Interest", value: "Guitar" },
  ],
  activeThreads: [
    {
      existingThreadId: "",
      topic: "Pinecrest house renovation",
      state: "Permit received and renovation work is moving into execution.",
      whyItMatters: "The project followed a difficult contractor dispute and remains a major focus.",
      nextChangeSignal: "Meaningful construction progress or another project milestone.",
    },
    {
      existingThreadId: "",
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

describe("relationship discovery onboarding", () => {
  it("creates a low-confidence relationship from confirmed Gmail metadata without inventing history", () => {
    const record = createDiscoveredRelationshipRecord(
      {
        personLabel: "Mike Curtis",
        identity: {
          kind: "email",
          value: "MIKE@example.com ",
          source: "gmail",
          label: "Mike Curtis",
        },
        lastObservedAt: "2026-11-04",
        uncertainty: "Repeated correspondence observed",
        evidenceSummary: [
          "Messages were observed both sent and received.",
          "They span 5 dates and 4 threads.",
        ],
      },
      ["Former colleague", "Personal relationship"],
      ["Peer"],
      new Date("2026-11-11T12:00:00Z"),
    );

    expect(record.relationshipContexts).toEqual(["Former colleague", "Personal relationship"]);
    expect(record.relationshipRoles).toEqual(["Peer"]);
    expect(record.classification).toBe("Friend or family");
    expect(record.lastInteractionAt).toBe("2026-11-04");
    expect(record.identities).toHaveLength(1);
    expect(record.identities[0]).toMatchObject({
      kind: "email",
      value: "mike@example.com",
      source: "gmail",
      confirmed: true,
    });
    expect(record.history.pattern).toContain("metadata-only Gmail discovery");
    expect(record.history.pattern).toContain("Repeated correspondence observed");
    expect(record.unknowns.join(" ")).toContain("have not been reconstructed");
    expect(record.durableFacts).toEqual([]);
    expect(record.activeThreads).toEqual([]);
  });

  it("supports multiple relationship contexts during lightweight confirmation", () => {
    const record = createManualRelationshipRecord(
      "Person B",
      ["Former colleague", "Personal relationship"],
      ["Peer", "Collaborator"],
    );

    expect(record.relationshipContexts).toEqual(["Former colleague", "Personal relationship"]);
    expect(record.relationshipRoles).toEqual(["Peer", "Collaborator"]);
  });
});

describe("relationship label correction", () => {
  it("replaces confirmed contexts and roles without disturbing accumulated memory", () => {
    const seeded = createManualRelationshipRecord(
      "Mike Curtis",
      ["Former colleague", "Professional contact"],
      ["Collaborator", "Peer"],
      new Date("2026-11-12T12:00:00Z"),
    );
    const withMemory = mergeInteractionIntoRelationship(
      seeded,
      extraction,
      {
        id: "transcript:mike",
        source: "transcript",
        observedAt: "2026-11-04",
        label: "Call transcript",
      },
      new Date("2026-11-12T13:00:00Z"),
    );

    const corrected = replaceRelationshipLabels(
      withMemory,
      ["Former colleague", "Personal relationship"],
      ["Peer"],
      new Date("2026-11-12T14:00:00Z"),
    );

    expect(corrected.relationshipContexts).toEqual(["Former colleague", "Personal relationship"]);
    expect(corrected.relationshipRoles).toEqual(["Peer"]);
    expect(corrected.classification).toBe("Friend or family");
    expect(corrected.durableFacts).toEqual(withMemory.durableFacts);
    expect(corrected.activeThreads).toEqual(withMemory.activeThreads);
    expect(corrected.sources).toEqual(withMemory.sources);
  });
});

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

  it("reconciles open commitments instead of accumulating fulfilled or superseded promises", () => {
    const record = createManualRelationshipRecord("Mike Curtis");
    const firstExtraction: InteractionExtraction = {
      ...extraction,
      durableFacts: [],
      activeThreads: [],
      openLoops: [{
        commitment: "Ping Jason after travel to schedule the product deep dive.",
        owner: "Mike",
        status: "Open",
      }],
      stewardshipOpportunities: [],
    };
    const first = mergeInteractionIntoRelationship(
      record,
      firstExtraction,
      {
        id: "transcript:nov4",
        source: "transcript",
        observedAt: "2026-11-04",
        label: "Call transcript",
      },
    );

    const secondExtraction: InteractionExtraction = {
      ...extraction,
      durableFacts: [],
      activeThreads: [],
      openLoops: [{
        commitment: "Reach out to schedule the next product walkthrough.",
        owner: "Mike",
        status: "Open",
      }],
      stewardshipOpportunities: [],
    };
    const second = mergeInteractionIntoRelationship(
      first,
      secondExtraction,
      {
        id: "transcript:nov11",
        source: "transcript",
        observedAt: "2026-11-11",
        label: "Call transcript",
      },
    );

    expect(first.openLoops).toHaveLength(1);
    expect(second.openLoops).toHaveLength(1);
    expect(second.openLoops[0].commitment).toBe("Reach out to schedule the next product walkthrough.");
    expect(second.openLoops[0].sourceIds).toEqual(["transcript:nov11"]);
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
        existingThreadId: first.activeThreads[0].id,
        topic: "House construction progress",
        state: "Demolition is complete and construction is underway.",
        whyItMatters: "The project has moved into a new phase.",
        nextChangeSignal: "Major construction milestone.",
      }],
      stewardshipOpportunities: [{
        reason: "The house has moved into construction.",
        trigger: "A later construction milestone.",
      }],
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

    expect(second.activeThreads).toHaveLength(first.activeThreads.length);
    expect(second.activeThreads[0].topic).toBe("House construction progress");
    expect(second.activeThreads[0].state).toContain("construction is underway");
    expect(second.activeThreads[0].sourceIds).toEqual(["transcript:first", "transcript:second"]);
    expect(second.stewardshipOpportunities).toHaveLength(1);
    expect(second.stewardshipOpportunities[0].reason).toContain("moved into construction");
  });
});
