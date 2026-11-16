import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord, replaceRelationshipIntention } from "./relationship-record";
import { buildStewardshipCandidates, reviewRelationshipWithOpenAI } from "./relationship-stewardship";
import type { RelationshipRecord } from "./relationship-record";

function exampleRelationship(): RelationshipRecord {
  const initial = createManualRelationshipRecord(
    "Alex Rivera", ["Former colleague", "Personal relationship"], ["Peer"],
    new Date("2026-11-01T12:00:00Z"),
  );
  const record = replaceRelationshipIntention(
    initial, "Stay Connected", "Stay aware of important changes and share useful ideas.",
    new Date("2026-11-08T12:00:00Z"),
  );
  record.lastInteractionAt = "2026-11-08";
  record.sources.push({
    id: "transcript:fictional", source: "transcript",
    observedAt: "2026-11-08", label: "Fictional meeting",
  });
  record.durableFacts = [{
    id: "fact:1", category: "Work", label: "New venture",
    value: "Building a developer tool.", sourceIds: ["transcript:fictional"],
    firstObservedAt: "2026-11-08", lastObservedAt: "2026-11-08",
  }];
  record.stewardshipOpportunities = [{
    id: "opportunity:1", reason: "A new beta may need early customer feedback.",
    trigger: "When beta signup opens.",
    observedAt: "2026-11-08", sourceIds: ["transcript:fictional"],
  }];
  record.activeThreads = [{
    id: "thread:1", topic: "Developer tool beta", state: "Preparing the first beta.",
    whyItMatters: "Early users could shape the product.",
    nextChangeSignal: "Beta opens for testers.",
    lastObservedAt: "2026-11-08", sourceIds: ["transcript:fictional"],
  }];
  record.openLoops = [{
    commitment: "Schedule a walkthrough when the beta is ready.",
    owner: "Alex", status: "Open", sourceIds: ["transcript:fictional"],
  }];
  return record;
}

function outputResponse(data: unknown) {
  return new Response(JSON.stringify({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(data) }] }],
  }), { status: 200 });
}

function modelResponse(data: unknown): typeof fetch {
  return async () => outputResponse(data);
}

const options = {
  apiKey: "test-key", model: "test-model", reviewedAt: "2026-11-15", userLabel: "Jason",
};

describe("on-demand relationship stewardship", () => {
  it("does not call a model if the user has not set an intention", async () => {
    const record = createManualRelationshipRecord("Example person");
    let calls = 0;
    const result = await reviewRelationshipWithOpenAI(record, {
      ...options,
      fetchImpl: async () => { calls++; throw new Error("should not be called"); },
    });
    expect(result.kind).toBe("no-action");
    expect(result.noActionReason).toContain("Set your intended relationship mode");
    expect(calls).toBe(0);
  });

  it("returns no action without a model call when there is no source-backed reason", async () => {
    const record = replaceRelationshipIntention(createManualRelationshipRecord("Example person"), "Stay Close", "");
    const result = await reviewRelationshipWithOpenAI(record, {
      ...options,
      fetchImpl: async () => { throw new Error("should not be called"); },
    });
    expect(result).toMatchObject({ kind: "no-action", recommendations: [] });
    expect(result.noActionReason).toContain("source-backed");
  });

  it("builds candidates from known sources and omits untraceable guesses", () => {
    const record = exampleRelationship();
    record.stewardshipOpportunities.push({
      id: "guess", reason: "Maybe something happened.", trigger: "Sometime",
      observedAt: "2026-11-08", sourceIds: ["missing:source"],
    });
    const candidates = buildStewardshipCandidates(record);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.evidence.length > 0)).toBe(true);
    expect(candidates.map((candidate) => candidate.id)).not.toContain("opportunity:guess");
  });

  it("uses intention and bounded structured memory without raw transcripts or model storage", async () => {
    const record = exampleRelationship();
    record.openLoops.push({
      commitment: "Jason promised to send feedback on the prototype.",
      owner: "Jason", status: "Open", sourceIds: ["transcript:fictional"],
    });
    let requestBody = "";
    const result = await reviewRelationshipWithOpenAI(record, {
      ...options,
      fetchImpl: async (_url, init) => {
        requestBody = String(init?.body);
        return outputResponse({
          recommendations: [{
            basisId: "commitment:1",
            action: "Send Alex the prototype feedback you promised.",
            whyNow: "Jason owns a specific unresolved commitment from the last meeting.",
          }],
          noActionReason: "",
        });
      },
    });
    expect(result.kind).toBe("recommendations");
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].evidence).toEqual([{
      id: "transcript:fictional", observedAt: "2026-11-08", label: "Fictional meeting",
    }]);
    const sent = JSON.parse(requestBody);
    expect(sent).toMatchObject({ model: "test-model", store: false });
    const input = JSON.parse(String(sent.input));
    expect(input.intention.mode).toBe("Stay Connected");
    expect(input.intention.desiredOutcome).toContain("share useful ideas");
    expect(input.candidates.length).toBe(4);
    expect(JSON.stringify(input)).not.toContain("transcript text");
    expect(JSON.stringify(input)).not.toContain("gmail body");
  });

  it("accepts a genuine no-action result for future-only triggers", async () => {
    const result = await reviewRelationshipWithOpenAI(exampleRelationship(), {
      ...options,
      fetchImpl: modelResponse({
        recommendations: [],
        noActionReason: "The beta opening has not been confirmed, and Alex owns the next step.",
      }),
    });
    expect(result.kind).toBe("no-action");
    expect(result.noActionReason).toContain("Alex owns the next step");
  });

  it("rejects invented candidate IDs, repeated suggestions, and another person's commitments", async () => {
    const result = await reviewRelationshipWithOpenAI(exampleRelationship(), {
      ...options,
      fetchImpl: modelResponse({
        recommendations: [
          { basisId: "made-up", action: "Do something", whyNow: "No evidence" },
          { basisId: "commitment:0", action: "Pressure Alex to schedule", whyNow: "Alex owns the next step" },
          { basisId: "thread:thread:1", action: "Check a real milestone", whyNow: "Only if the beta is known to have opened" },
          { basisId: "thread:thread:1", action: "Duplicate", whyNow: "Same evidence" },
        ],
        noActionReason: "No reliable action is known.",
      }),
    });
    expect(result.recommendations.map((item) => item.basisId)).toEqual(["thread:thread:1"]);
    expect(result.recommendations[0].evidence[0].id).toBe("transcript:fictional");
  });

  it("falls back to no action if all model suggestions lack evidence", async () => {
    const result = await reviewRelationshipWithOpenAI(exampleRelationship(), {
      ...options,
      fetchImpl: modelResponse({
        recommendations: [{ basisId: "invented", action: "Send a note", whyNow: "Just because" }],
        noActionReason: "",
      }),
    });
    expect(result).toMatchObject({ kind: "no-action", recommendations: [] });
    expect(result.noActionReason).toContain("specific, timely reason");
  });

  it("fails closed on a refusal", async () => {
    await expect(reviewRelationshipWithOpenAI(exampleRelationship(), {
      ...options,
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "refusal", refusal: "Cannot comply" }] }],
      }), { status: 200 }),
    })).rejects.toThrow("declined");
  });
});
