import { describe, expect, it } from "vitest";
import {
  evaluateRelationshipInference,
  groundTruthAsInference,
  relationshipBenchmarkCases,
  validateRelationshipInference,
  type RelationshipInference,
} from "./inference-benchmark";

describe("fictional relationship inference benchmark", () => {
  it("contains seven distinct fictional cases with only fictional labels", () => {
    expect(relationshipBenchmarkCases).toHaveLength(7);
    expect(new Set(relationshipBenchmarkCases.map((item) => item.id)).size).toBe(7);

    for (const benchmark of relationshipBenchmarkCases) {
      expect(benchmark.threads.length).toBeGreaterThan(0);
      expect(benchmark.threads.every((thread) => !thread.from.includes("@") && !thread.to.includes("@"))).toBe(true);
      expect(benchmark.threads.every((thread) => Date.parse(thread.date) <= Date.parse(benchmark.asOfDate))).toBe(true);
      expect(benchmark.groundTruth.mustNotInfer.length).toBeGreaterThan(0);
    }
  });

  it("covers the Stage 1 relationship dispositions", () => {
    const dispositions = new Set(relationshipBenchmarkCases.map((item) => item.groundTruth.disposition));
    expect(dispositions).toEqual(new Set(["Relationship worth managing", "Background only", "Unclear"]));
  });

  it("keeps the completed service transaction in the background", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "transactional-service");
    expect(benchmark?.groundTruth).toMatchObject({
      classification: "Service provider",
      disposition: "Background only",
      openLoops: [],
      reasonsToEngage: [],
    });
  });

  it("makes the intentionally ambiguous case genuinely uncertain", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "ambiguous-contact");
    expect(benchmark?.groundTruth.classification).toBe("Unknown");
    expect(benchmark?.groundTruth.disposition).toBe("Unclear");
    expect(benchmark?.groundTruth.currentState).toBe("Unclear");
    expect(benchmark?.groundTruth.unknowns.length).toBeGreaterThan(1);
  });

  it("represents an explicitly multi-role relationship without flattening it", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "multi-role-history")!;
    const inference = groundTruthAsInference(benchmark);
    expect(inference.relationshipContexts.map((item) => item.value)).toEqual([
      "Former colleague",
      "Personal relationship",
    ]);
    expect(inference.relationshipRoles.map((item) => item.value)).toEqual([
      "Friend",
      "Mentor",
    ]);
  });

  it("uses the as-of date to keep a real recruiter promise overdue without inventing the call outcome", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "recruiter-ambiguous");
    expect(benchmark?.asOfDate).toBe("2026-10-25");
    expect(benchmark?.groundTruth.openLoops).toEqual([
      {
        commitment: "Send the company overview and compensation range",
        owner: "Jordan Blake",
        status: "Overdue",
      },
    ]);
    expect(benchmark?.groundTruth.unknowns[0]).toContain("Tuesday conversation");
  });

  it("accepts a complete structured inference", () => {
    for (const benchmark of relationshipBenchmarkCases) {
      expect(validateRelationshipInference(groundTruthAsInference(benchmark))).toEqual([]);
    }
  });

  it("rejects malformed structured output", () => {
    expect(validateRelationshipInference(null)).toEqual(["Inference must be an object."]);
    expect(validateRelationshipInference({
      classification: { value: "Wizard", evidenceIds: [] },
      disposition: { value: "Background only", evidenceIds: [] },
      currentState: { value: "Dormant", evidenceIds: [] },
      tags: [],
      history: {
        earliestObservedMeaningfulInteraction: "2026-01-01",
        latestObservedMeaningfulInteraction: "2026-01-01",
        pattern: "test",
        evidenceIds: [],
      },
      openLoops: [],
      reasonsToEngage: [],
      unknowns: [],
      confidence: "Certain",
    })).toEqual(expect.arrayContaining(["classification is invalid.", "confidence is invalid."]));
  });

  it("passes every hard gate for a ground-truth-shaped inference", () => {
    for (const benchmark of relationshipBenchmarkCases) {
      const report = evaluateRelationshipInference(benchmark, groundTruthAsInference(benchmark));
      expect(report.hardGatePass).toBe(true);
      expect(report.hardGates.classificationAccepted).toBe(true);
      expect(report.hardGates.dispositionCorrect).toBe(true);
      expect(report.hardGates.currentStateCorrect).toBe(true);
      expect(report.hardGates.earliestObservedCorrect).toBe(true);
      expect(report.hardGates.latestObservedCorrect).toBe(true);
      expect(report.hardGates.citationsValid).toBe(true);
      expect(report.hardGates.openLoopHardPass).toBe(true);
      expect(report.hardGates.uncertaintyPresent).toBe(true);
      expect(report.softReview.tags.precision).toBe(1);
      expect(report.softReview.tags.recall).toBe(1);
      expect(report.softReview.relationshipContexts.precision).toBe(1);
      expect(report.softReview.relationshipContexts.recall).toBe(1);
      expect(report.softReview.relationshipRoles.precision).toBe(1);
      expect(report.softReview.relationshipRoles.recall).toBe(1);
      expect(report.invalidCitations).toEqual([]);
    }
  });

  it("flags citations to thread ids that were never supplied", () => {
    const benchmark = relationshipBenchmarkCases[0];
    const inference = groundTruthAsInference(benchmark);
    inference.classification.evidenceIds = ["made-up-thread"];
    const report = evaluateRelationshipInference(benchmark, inference);
    expect(report.invalidCitations).toEqual(["made-up-thread"]);
  });

  it("accepts configured tag aliases but still penalizes unrelated extra tags", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "transactional-service")!;
    const inference: RelationshipInference = groundTruthAsInference(benchmark);
    inference.tags = [
      { label: "airport pickup service", evidenceIds: ["service-1", "service-2"] },
      { label: "completed transaction; positive feedback", evidenceIds: ["service-3"] },
    ];
    const report = evaluateRelationshipInference(benchmark, inference);
    expect(report.softReview.tags.matched).toBe(1);
    expect(report.softReview.tags.recall).toBe(0.5);
    expect(report.softReview.tags.precision).toBe(0.5);
  });

  it("penalizes unsupported extra tags instead of rewarding verbosity", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "active-personal")!;
    const inference: RelationshipInference = groundTruthAsInference(benchmark);
    inference.tags.push({ label: "venture capital", evidenceIds: ["personal-1"] });
    const report = evaluateRelationshipInference(benchmark, inference);
    expect(report.softReview.tags.recall).toBe(1);
    expect(report.softReview.tags.precision).toBeLessThan(1);
  });

  it("accepts a defensible professional-contact classification for the ambiguous case", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "ambiguous-contact")!;
    const inference = groundTruthAsInference(benchmark);
    inference.classification.value = "Professional contact";
    const report = evaluateRelationshipInference(benchmark, inference);
    expect(report.hardGates.classificationAccepted).toBe(true);
    expect(report.hardGatePass).toBe(true);
  });

  it("allows conservative omission of an optional coworker open loop", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "coworker-operational")!;
    const inference = groundTruthAsInference(benchmark);
    inference.openLoops = [];
    const report = evaluateRelationshipInference(benchmark, inference);
    expect(report.hardGates.openLoopHardPass).toBe(true);
  });

  it("still requires the explicit overdue recruiter promise", () => {
    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "recruiter-ambiguous")!;
    const inference = groundTruthAsInference(benchmark);
    inference.openLoops = [];
    const report = evaluateRelationshipInference(benchmark, inference);
    expect(report.hardGates.openLoopHardPass).toBe(false);
    expect(report.hardGatePass).toBe(false);
  });

  it("does not include the user's two-state relationship goal in the inference contract", () => {
    const inference = groundTruthAsInference(relationshipBenchmarkCases[0]) as RelationshipInference & { goal?: string };
    expect("goal" in inference).toBe(false);
  });
});
