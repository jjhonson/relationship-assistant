import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import { createPersonalMoment } from "./personal-moment";
import {
  buildMomentPersonCandidates,
  reviewPeopleForMoment,
  MOMENT_MATCH_PROMPT,
} from "./moment-people";
import type { RelationshipRecord } from "./relationship-record";

function personWithGuitarInterest(): RelationshipRecord {
  const person = createManualRelationshipRecord("Tom (fictional)");
  person.sources.push({ id: "capture:fictional-guitar", source: "capture",
    observedAt: "2026-11-19", label: "Fictional saved note" });
  person.durableFacts = [{
    id: "fact:tom-guitar", category: "Interest", label: "Hobby", value: "Learning guitar",
    firstObservedAt: "2026-11-19", lastObservedAt: "2026-11-19",
    sourceIds: ["capture:fictional-guitar"],
  }];
  return person;
}

function modelResponse(value: unknown): typeof fetch {
  return async () => new Response(JSON.stringify({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }), { status: 200 });
}

const options = { apiKey: "fictional-api-key", reviewedAt: "2026-11-21", model: "fictional-model" };

describe("moment-to-person matching", () => {
  it("matches a personally meaningful guitar resource to a sourced guitar learner without inventing a channel", async () => {
    const person = personWithGuitarInterest();
    const moment = createPersonalMoment({
      description: "Found a useful beginner guitar exercise",
      reflection: "I thought this was a clear practical explanation of chord changes.",
      url: "https://example.org/guitar?token=not-sent",
      consideration: "consider-people",
    });
    let sent = {} as Record<string, unknown>;
    const review = await reviewPeopleForMoment(moment, [person], {
      ...options,
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return modelResponse({ matches: [{
          relationshipId: person.id,
          reason: "You found a practical chord-change exercise and Tom has told you he is learning guitar.",
          possibleAngle: "This could be useful if he is currently practicing chord changes.",
          sourceIds: ["capture:fictional-guitar"],
        }], noMatchReason: "" })("https://example.test");
      },
    });
    expect(review.kind).toBe("matches");
    expect(review.matches).toHaveLength(1);
    expect(review.matches[0].personLabel).toBe("Tom (fictional)");
    expect(review.matches[0].reason).toContain("chord-change");
    expect(review.matches[0].evidence).toEqual([
      { id: "capture:fictional-guitar", label: "Fictional saved note", observedAt: "2026-11-19" },
    ]);
    expect(sent.store).toBe(false);
    expect(sent.model).toBe("fictional-model");
    const input = JSON.parse(String(sent.input));
    expect(input.moment.reflection).toContain("chord changes");
    expect(JSON.stringify(input)).not.toContain("token=not-sent");
    expect(JSON.stringify(input)).not.toContain("raw transcript");
    expect(JSON.stringify(input)).not.toContain("gmail body");
  });

  it("does not send private moments to a model, even when a relevant person exists", async () => {
    const moment = createPersonalMoment({
      description: "Private documentary notes",
      reflection: "I did not enjoy the documentary, but the questions it raised interested me.",
    });
    const result = await reviewPeopleForMoment(moment, [personWithGuitarInterest()], {
      ...options, apiKey: "",
      fetchImpl: async () => { throw new Error("model must not be called"); },
    });
    expect(result).toMatchObject({ kind: "no-match", matches: [] });
    expect(result.noMatchReason).toContain("private");
  });

  it("returns no match without a model call when existing people have no source-backed interests", async () => {
    const moment = createPersonalMoment({
      description: "Read a thoughtful essay about community",
      consideration: "consider-people",
    });
    const result = await reviewPeopleForMoment(moment, [createManualRelationshipRecord("Judy (fictional)")], {
      ...options, apiKey: "",
      fetchImpl: async () => { throw new Error("model must not be called"); },
    });
    expect(result.kind).toBe("no-match");
    expect(result.noMatchReason).toContain("sourced relationship");
  });

  it("never promotes unsupported personal facts or a person's unsupported sources into candidates", () => {
    const person = personWithGuitarInterest();
    person.durableFacts.push({
      id: "fact:missing", category: "Interest", label: "Likes films",
      value: "Loves documentaries", firstObservedAt: "2026-11-19",
      lastObservedAt: "2026-11-19", sourceIds: ["missing-evidence"],
    });
    const [candidate] = buildMomentPersonCandidates([person]);
    expect(candidate.claims.some((c) => c.description.includes("documentaries"))).toBe(false);
    expect(candidate.evidence.map((e) => e.id)).toEqual(["capture:fictional-guitar"]);
  });

  it("rejects model-invented people, foreign evidence, duplicates and evidence-free recommendations", async () => {
    const person = personWithGuitarInterest();
    const moment = createPersonalMoment({ description: "Good beginner guitar lesson",
      reflection: "Clear chord changes", consideration: "consider-people" });
    const review = await reviewPeopleForMoment(moment, [person], {
      ...options, fetchImpl: modelResponse({ matches: [
        { relationshipId: "invented-person", reason: "Invented", possibleAngle: "", sourceIds: ["capture:fictional-guitar"] },
        { relationshipId: person.id, reason: "Unsupported proof", possibleAngle: "", sourceIds: ["capture:someone-else"] },
        { relationshipId: person.id, reason: "Tom is learning guitar and I found a relevant lesson",
          possibleAngle: "Ask if he wants a chord-change exercise", sourceIds: ["capture:fictional-guitar"] },
        { relationshipId: person.id, reason: "Repeated", possibleAngle: "", sourceIds: ["capture:fictional-guitar"] },
      ], noMatchReason: "" }),
    });
    expect(review.matches).toHaveLength(1);
    expect(review.matches[0].relationshipId).toBe(person.id);
  });

  it("respects critical or ambivalent sentiment and permits an explicit no-match", async () => {
    const moment = createPersonalMoment({
      description: "Watched a documentary I did not enjoy",
      reflection: "Its exploration of power was thought-provoking, but it was not a good film.",
      consideration: "consider-people",
    });
    const review = await reviewPeopleForMoment(moment, [personWithGuitarInterest()], {
      ...options, fetchImpl: modelResponse({ matches: [],
        noMatchReason: "No known person has a sourced interest in the question that mattered to you." }),
    });
    expect(review).toMatchObject({ kind: "no-match", matches: [] });
    expect(MOMENT_MATCH_PROMPT).toContain("not an endorsement or recommendation");
    expect(MOMENT_MATCH_PROMPT).toContain("critical or ambivalent");
  });

  it("fails closed on refusals, malformed output and provider errors", async () => {
    const moment = createPersonalMoment({
      description: "A useful guitar idea", consideration: "consider-people",
    });
    const person = personWithGuitarInterest();
    await expect(reviewPeopleForMoment(moment, [person], {
      ...options,
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "refusal", refusal: "Not available" }] }],
      })),
    })).rejects.toThrow("declined");
    await expect(reviewPeopleForMoment(moment, [person], {
      ...options, fetchImpl: modelResponse("invalid JSON object"),
    })).rejects.toThrow("Invalid moment match response");
    await expect(reviewPeopleForMoment(moment, [person], {
      ...options, fetchImpl: async () => new Response("Private provider text", { status: 503 }),
    })).rejects.toThrow("status 503");
  });
});
