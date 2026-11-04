import { describe, expect, it, vi } from "vitest";
import { relationshipBenchmarkCases } from "./inference-benchmark";
import {
  DEFAULT_OPENAI_RELATIONSHIP_MODEL,
  inferRelationshipWithOpenAI,
} from "./openai-inference";

function successfulInference() {
  return {
    classification: { value: "Service provider", evidenceIds: ["service-1", "service-2", "service-3"] },
    disposition: { value: "Background only", evidenceIds: ["service-1", "service-2", "service-3"] },
    currentState: { value: "Dormant", evidenceIds: ["service-3"] },
    tags: [
      { label: "travel", evidenceIds: ["service-1"] },
      { label: "airport transportation", evidenceIds: ["service-1", "service-2"] },
    ],
    history: {
      earliestObservedMeaningfulInteraction: "2026-06-04",
      latestObservedMeaningfulInteraction: "2026-06-05",
      pattern: "A brief completed service exchange.",
      evidenceIds: ["service-1", "service-2", "service-3"],
    },
    openLoops: [],
    reasonsToEngage: [],
    unknowns: ["The correspondence does not establish any relationship beyond the completed service."],
    confidence: "High",
  };
}

describe("OpenAI fictional relationship inference adapter", () => {
  it("requires an API key before making a request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      inferRelationshipWithOpenAI(relationshipBenchmarkCases[0], {
        apiKey: "",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("OPENAI_API_KEY is required.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the Responses API with store disabled and strict structured output", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(DEFAULT_OPENAI_RELATIONSHIP_MODEL);
      expect(body.store).toBe(false);
      expect(body.reasoning).toEqual({ effort: "medium" });
      expect(body.text.format.type).toBe("json_schema");
      expect(body.text.format.strict).toBe(true);
      expect(body.text.format.name).toBe("relationship_inference");
      expect(body.input).toContain("Completed one-time service transaction");
      expect(body.input).not.toContain("Background only / no relationship management");
      expect(String(init?.headers && JSON.stringify(init.headers))).not.toContain("service-1");

      return new Response(
        JSON.stringify({
          id: "resp_test",
          model: DEFAULT_OPENAI_RELATIONSHIP_MODEL,
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(successfulInference()) }],
            },
          ],
          usage: { input_tokens: 700, output_tokens: 300, total_tokens: 1000 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const benchmark = relationshipBenchmarkCases.find((item) => item.id === "transactional-service")!;
    const result = await inferRelationshipWithOpenAI(benchmark, {
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.provider).toBe("openai");
    expect(result.responseId).toBe("resp_test");
    expect(result.report.classificationCorrect).toBe(true);
    expect(result.report.dispositionCorrect).toBe(true);
    expect(result.report.invalidCitations).toEqual([]);
    expect(result.usage.totalTokens).toBe(1000);
  });

  it("does not echo provider response bodies when the API fails", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("sensitive provider body", { status: 401 }),
    );

    await expect(
      inferRelationshipWithOpenAI(relationshipBenchmarkCases[0], {
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("OpenAI inference request failed with status 401.");

    await expect(
      inferRelationshipWithOpenAI(relationshipBenchmarkCases[0], {
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.not.toThrow("sensitive provider body");
  });

  it("rejects malformed structured content even after a successful HTTP response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ confidence: "High" }) }] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      inferRelationshipWithOpenAI(relationshipBenchmarkCases[0], {
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Structured inference failed local validation");
  });

  it("treats a refusal as a controlled benchmark failure", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      inferRelationshipWithOpenAI(relationshipBenchmarkCases[0], {
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Model refused the fictional inference request.");
  });
});
