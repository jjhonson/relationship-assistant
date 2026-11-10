import { describe, expect, it, vi } from "vitest";
import {
  inferInteractionWithOpenAI,
  INTERACTION_INFERENCE_SYSTEM_PROMPT,
} from "./interaction-inference";

describe("interaction inference", () => {
  it("requires durable relationship anchors even when they are not immediately actionable", () => {
    expect(INTERACTION_INFERENCE_SYSTEM_PROMPT).toContain("Always capture explicit relationship anchors");
    expect(INTERACTION_INFERENCE_SYSTEM_PROMPT).toContain("birthdays and anniversaries");
    expect(INTERACTION_INFERENCE_SYSTEM_PROMPT).toContain("employer/job/role");
  });

  it("uses structured output with provider storage disabled and returns only structured relationship intelligence", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.instructions).toBe(INTERACTION_INFERENCE_SYSTEM_PROMPT);
      expect(body.input).toContain("Austin has been learning guitar");
      expect(body.input).toContain("thread-house");
      expect(body.text.format.type).toBe("json_schema");

      return new Response(JSON.stringify({
        model: "test-model",
        output: [{
          content: [{
            type: "output_text",
            text: JSON.stringify({
              summary: "Catch-up with family, guitar, and renovation context.",
              relationshipContexts: ["Personal relationship"],
              relationshipRoles: [],
              tags: ["guitar", "renovation"],
              durableFacts: [
                { existingFactId: "fact-austin", category: "Family", label: "Son", value: "Austin" },
                { existingFactId: "", category: "Interest", label: "Interest", value: "Guitar" },
              ],
              activeThreads: [{
                existingThreadId: "thread-house",
                topic: "House renovation",
                state: "Permit received.",
                whyItMatters: "It is a major ongoing project.",
                nextChangeSignal: "Construction progress.",
              }],
              openLoops: [],
              stewardshipOpportunities: [{
                reason: "The renovation is likely to change.",
                trigger: "When construction has had time to progress.",
              }],
              unknowns: [],
            }),
          }],
        }],
        usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
      }), { status: 200 });
    });

    const result = await inferInteractionWithOpenAI({
      personLabel: "Matthew",
      interactionDate: "2026-11-06",
      transcript: "Austin has been learning guitar. The renovation permit finally came through.",
      currentMemory: {
        durableFacts: [
          { id: "fact-austin", category: "Family", label: "Son", value: "Austin" },
        ],
        activeThreads: [
          { id: "thread-house", topic: "Pinecrest house renovation", state: "Permit received." },
        ],
      },
    }, {
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.extraction.durableFacts[0]).toEqual({
      existingFactId: "fact-austin",
      category: "Family",
      label: "Son",
      value: "Austin",
    });
    expect(result.extraction.activeThreads[0].topic).toBe("House renovation");
    expect(result.usage.totalTokens).toBe(180);
    expect(JSON.stringify(result)).not.toContain("The renovation permit finally came through.");
  });

  it("allows no stewardship opportunity when the interaction does not support one", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            summary: "Brief completed exchange.",
            relationshipContexts: [],
            relationshipRoles: [],
            tags: [],
            durableFacts: [],
            activeThreads: [],
            openLoops: [],
            stewardshipOpportunities: [],
            unknowns: ["No ongoing relationship context is established."],
          }),
        }],
      }],
    }), { status: 200 }));

    const result = await inferInteractionWithOpenAI({
      personLabel: "Person A",
      interactionDate: "2026-11-06",
      transcript: "Thanks, received.",
    }, {
      apiKey: "test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.extraction.stewardshipOpportunities).toEqual([]);
  });
});
