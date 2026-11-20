import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import {
  buildConnectionCandidates,
  reviewConnectionSubjects,
  CONNECTION_SYSTEM_PROMPT,
} from "./connection-subjects";
import type { RelationshipRecord } from "./relationship-record";

function relationship(): RelationshipRecord {
  const record = createManualRelationshipRecord("Alex Rivera");
  record.lastInteractionAt = "2026-11-12";
  record.sources.push({
    id: "transcript:fictional", source: "transcript",
    observedAt: "2026-11-12", label: "Fictional call",
  });
  record.durableFacts = [{
    id: "fact:guitar", category: "Interest", label: "Hobby",
    value: "Learning guitar", sourceIds: ["transcript:fictional"],
    firstObservedAt: "2026-11-12", lastObservedAt: "2026-11-12",
  }];
  record.activeThreads = [{
    id: "thread:project", topic: "New developer tool", state: "Preparing a beta",
    whyItMatters: "Hopes to get feedback from early users.",
    nextChangeSignal: "When beta signup opens", lastObservedAt: "2026-11-12",
    sourceIds: ["transcript:fictional"],
  }];
  return record;
}

function modelResponse(value: unknown): typeof fetch {
  return async () => new Response(JSON.stringify({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }));
}

const options = { apiKey: "fake-test-key", userLabel: "Jason", model: "test-model", reviewedAt: "2026-11-20" };

describe("person-first connection subjects", () => {
  it("suggests evidence-backed subjects even without a mandatory closeness or frequency mode", async () => {
    const record = relationship();
    expect(record.intention).toBeNull();
    let sent: Record<string, unknown> = {};
    const review = await reviewConnectionSubjects(record, {
      ...options,
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return modelResponse({
          suggestions: [{
            basisId: "fact:fact:guitar",
            subject: "Alex learning guitar",
            whyRelevant: "Alex mentioned learning guitar in your last conversation.",
            possibleAngle: "Ask what they have enjoyed playing so far.",
          }],
          noSuggestionReason: "",
        })("https://example.test");
      },
    });
    expect(review.kind).toBe("suggestions");
    expect(review.suggestions).toHaveLength(1);
    expect(review.suggestions[0].subject).toContain("guitar");
    expect(review.suggestions[0].evidence).toEqual([
      { id: "transcript:fictional", label: "Fictional call", observedAt: "2026-11-12" },
    ]);
    expect(sent.model).toBe("test-model");
    expect(sent.store).toBe(false);
    const input = JSON.parse(String(sent.input)) as Record<string, unknown>;
    expect(input.person).toBe("Alex Rivera");
    expect(input.userStatedRelationshipIntent).toBe("");
    expect(JSON.stringify(input)).not.toContain("raw transcript");
    expect(JSON.stringify(input)).not.toContain("gmail body");
  });

  it("returns no suggestion without requesting AI for a sparse person with no source-backed subject", async () => {
    const record = createManualRelationshipRecord("Neighbor whose name I just learned");
    const result = await reviewConnectionSubjects(record, {
      ...options, apiKey: "",
      fetchImpl: async () => { throw new Error("no model request expected"); },
    });
    expect(result.kind).toBe("no-suggestion");
    expect(result.suggestions).toEqual([]);
    expect(result.noSuggestionReason).toContain("source-backed");
  });

  it("ignores facts with missing evidence, and excludes promises owned by the other person", () => {
    const record = relationship();
    record.durableFacts.push({
      id: "unverified", category: "Interest", label: "Unknown",
      value: "Maybe loves sailing", sourceIds: ["missing-source"],
      firstObservedAt: "2026-11-12", lastObservedAt: "2026-11-12",
    });
    record.openLoops.push(
      { commitment: "Alex will send a prototype", owner: "Alex", status: "Open", sourceIds: ["transcript:fictional"] },
      { commitment: "Jason promised comments", owner: "Jason", status: "Open", sourceIds: ["transcript:fictional"] },
      { commitment: "Unclear who will send feedback", owner: "Jason", status: "Unclear", sourceIds: ["transcript:fictional"] },
    );
    const candidates = buildConnectionCandidates(record, "Jason");
    expect(candidates.map((item) => item.id)).not.toContain("fact:unverified");
    expect(candidates.map((item) => item.id)).not.toContain("commitment:0");
    expect(candidates.map((item) => item.id)).not.toContain("commitment:2");
    expect(candidates.map((item) => item.id)).toContain("commitment:1");
    expect(candidates.every((candidate) => candidate.evidence.length > 0)).toBe(true);
  });

  it("rejects invented IDs, duplicate candidates, and suggestions that merely name a channel", async () => {
    const record = relationship();
    const result = await reviewConnectionSubjects(record, {
      ...options,
      fetchImpl: modelResponse({
        suggestions: [
          { basisId: "made-up", subject: "A made-up new promotion", whyRelevant: "Invented", possibleAngle: "" },
          { basisId: "fact:fact:guitar", subject: "Email Alex", whyRelevant: "Email is convenient", possibleAngle: "" },
          {
            basisId: "fact:fact:guitar", subject: "Learning guitar",
            whyRelevant: "Mentioned during a fictional call", possibleAngle: "Ask about their progress.",
          },
          {
            basisId: "fact:fact:guitar", subject: "A duplicate angle",
            whyRelevant: "Same source", possibleAngle: "",
          },
          {
            basisId: "thread:thread:project", subject: "Learning guitar",
            whyRelevant: "Duplicate subject", possibleAngle: "",
          },
        ],
        noSuggestionReason: "",
      }),
    });
    expect(result.suggestions.map((item) => item.subject)).toEqual(["Learning guitar"]);
  });

  it("can explicitly suggest no outreach even when an unconfirmed future milestone is saved", async () => {
    const record = relationship();
    record.durableFacts = [];
    record.activeThreads = [];
    record.stewardshipOpportunities = [{
      id: "op1", reason: "Ask about beta if it has launched",
      trigger: "When the beta is available", observedAt: "2026-11-12",
      sourceIds: ["transcript:fictional"],
    }];
    const review = await reviewConnectionSubjects(record, {
      ...options, fetchImpl: modelResponse({
        suggestions: [],
        noSuggestionReason: "The beta opening has not been confirmed; no genuine timely connection is established.",
      }),
    });
    expect(review.kind).toBe("no-suggestion");
    expect(review.noSuggestionReason).toContain("not been confirmed");
  });

  it("keeps the prompts focused on subjects rather than selecting email or telephone", () => {
    expect(CONNECTION_SYSTEM_PROMPT).toContain("SUBJECTS");
    expect(CONNECTION_SYSTEM_PROMPT).toContain("Do NOT recommend an email");
    expect(CONNECTION_SYSTEM_PROMPT).toContain("not manage a sales pipeline");
  });

  it("fails closed on refused or malformed provider responses", async () => {
    const record = relationship();
    await expect(reviewConnectionSubjects(record, {
      ...options,
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "refusal", refusal: "No review" }] }],
      })),
    })).rejects.toThrow("declined");
    await expect(reviewConnectionSubjects(record, {
      ...options,
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: "not JSON" }] }],
      })),
    })).rejects.toThrow("Invalid connection review output");
  });
});
