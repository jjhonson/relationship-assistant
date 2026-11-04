import { describe, expect, it } from "vitest";
import { relationshipBenchmarkCases } from "./inference-benchmark";
import {
  RELATIONSHIP_INFERENCE_SYSTEM_PROMPT,
  buildRelationshipInferenceUserPrompt,
} from "./inference-prompt";

describe("relationship inference prompt", () => {
  it("contains the core uncertainty and safety rules", () => {
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Use Unknown or Unclear");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Do not infer whether the user wants more or less contact");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Do not convert vague social language into a firm commitment");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Tags must be short, stable, reusable categories");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Do not use tags to summarize a one-time event");
    expect(RELATIONSHIP_INFERENCE_SYSTEM_PROMPT).toContain("Return JSON only");
  });

  it("sends only the selected fictional case and its as-of date", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "recruiter-ambiguous")!;
    const prompt = buildRelationshipInferenceUserPrompt(benchmark);

    expect(prompt).toContain("As-of date: 2026-10-25");
    expect(prompt).toContain("THREAD recruiter-b1");
    expect(prompt).toContain("THREAD recruiter-b3");
    expect(prompt).not.toContain("personal-1");
    expect(prompt).not.toContain("dormant-b1");
  });

  it("does not leak ground-truth labels or must-not-infer instructions from the fixture", () => {
    for (const benchmark of relationshipBenchmarkCases) {
      const prompt = buildRelationshipInferenceUserPrompt(benchmark);
      for (const warning of benchmark.groundTruth.mustNotInfer) {
        expect(prompt).not.toContain(warning);
      }
      if (benchmark.groundTruth.disposition === "Background only") {
        expect(prompt).not.toContain("completed one-time service transaction should be Background only");
      }
    }
  });

  it("includes every supplied thread id so citations can be validated", () => {
    for (const benchmark of relationshipBenchmarkCases) {
      const prompt = buildRelationshipInferenceUserPrompt(benchmark);
      for (const thread of benchmark.threads) expect(prompt).toContain(`THREAD ${thread.id}`);
    }
  });
});
