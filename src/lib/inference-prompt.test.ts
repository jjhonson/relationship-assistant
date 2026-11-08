import { describe, expect, it } from "vitest";
import { relationshipBenchmarkCases } from "./inference-benchmark";
import {
  RELATIONSHIP_INFERENCE_SYSTEM_PROMPT,
  buildRelationshipInferenceUserPrompt,
} from "./inference-prompt";

function fixtureInput(caseId: string) {
  const benchmark = relationshipBenchmarkCases.find((item) => item.id === caseId)!;
  return {
    id: benchmark.id,
    title: benchmark.title,
    asOfDate: benchmark.asOfDate,
    messages: benchmark.threads.map((message) => ({
      ...message,
      source: "fixture" as const,
      conversationId: message.id,
    })),
  };
}

describe("relationship inference prompt", () => {
  it("contains the core uncertainty and safety rules", () => {
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Use Unknown or Unclear");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Do not infer whether the user wants more or less contact");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Do not convert vague social language into a firm commitment");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Tags must be short, stable, reusable categories");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Do not use tags to summarize a one-time event");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("A reason to engage must be a concrete, grounded trigger");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("General relevance, relationship context");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Return JSON only");
  });

  it("sends only the selected canonical correspondence and its as-of date", () => {
    const prompt = buildRelationshipInferenceUserPrompt(fixtureInput("recruiter-ambiguous"));

    expect(prompt).toContain("As-of date: 2026-10-25");
    expect(prompt).toContain("MESSAGE recruiter-b1");
    expect(prompt).toContain("MESSAGE recruiter-b3");
    expect(prompt).toContain("Source: fixture");
    expect(prompt).not.toContain("personal-1");
    expect(prompt).not.toContain("dormant-b1");
  });

  it("does not leak ground-truth labels or must-not-infer instructions from the fixture", () => {
    for (const benchmark of relationshipBenchmarkCases) {
      const prompt = buildRelationshipInferenceUserPrompt(fixtureInput(benchmark.id));
      for (const warning of benchmark.groundTruth.mustNotInfer) {
        expect(prompt).not.toContain(warning);
      }
      if (benchmark.groundTruth.disposition === "Background only") {
        expect(prompt).not.toContain("completed one-time service transaction should be Background only");
      }
    }
  });

  it("includes every supplied message id so citations can be validated", () => {
    for (const benchmark of relationshipBenchmarkCases) {
      const prompt = buildRelationshipInferenceUserPrompt(fixtureInput(benchmark.id));
      for (const message of benchmark.threads) {
        expect(prompt).toContain("MESSAGE " + message.id);
      }
    }
  });
});
