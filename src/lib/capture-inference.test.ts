import { describe, expect, it, vi } from "vitest";
import { CAPTURE_PHOTO_CONTEXT_PROMPT, CAPTURE_SYSTEM_PROMPT, inferCaptureWithOpenAI, validateCaptureExtraction } from "./capture-inference";

const response = {
  summary: "Met Tom and Judy across the fence.",
  participants: [
    { name: "Tom", email: "", phone: "", company: "", jobTitle: "", city: "", linkedin: "", facts: [] },
    { name: "Judy", email: "", phone: "", company: "", jobTitle: "", city: "", linkedin: "", facts: [] },
  ],
  sharedDetails: ["Their dogs are Pepper and Scout."],
  householdDetails: ["The household has dogs Pepper and Scout."],
  connections: [{ firstName: "Tom", secondName: "Judy", kind: "household", description: "They share a home." }],
  otherPeople: [],
  commitments: [],
};

describe("quick capture inference", () => {
  it("separates image evidence from user's context and instructs the model not to promote every card signer into a contact", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.instructions).toBe(CAPTURE_SYSTEM_PROMPT + "\n" + CAPTURE_PHOTO_CONTEXT_PROMPT);
      expect(body.input).toContain("Selected photo transcription and context");
      expect(body.input).toContain("Photo transcription");
      expect(body.store).toBe(false);
      return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({
        ...response,
        participants: [response.participants[0]],
        otherPeople: [{ name: "Cindy", connection: "Named on the holiday card" }],
      }) }] }] }));
    });
    const result = await inferCaptureWithOpenAI({
      note: "Photo transcription: Happy Diwali, from Tom and Cindy", capturedAt: "2026-11-18", source: "user-image",
      contextPersonLabel: "Tom",
    }, { apiKey: "fake-test-only", fetchImpl: fetchImpl as typeof fetch });
    expect(result.participants.map((person) => person.name)).toEqual(["Tom"]);
    expect(result.otherPeople.map((person) => person.name)).toEqual(["Cindy"]);
  });

  it("uses private, strict structured model output without treating source text as instructions", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.reasoning).toEqual({ effort: "medium" });
      expect(body.instructions).toBe(CAPTURE_SYSTEM_PROMPT);
      expect(body.text.format.strict).toBe(true);
      expect(body.text.format.name).toBe("relationship_quick_capture");
      expect(body.text.format.schema.required).toContain("connections");
      expect(body.text.format.schema.required).toContain("householdDetails");
      expect(body.input).toContain("Met Tom and Judy");
      expect(body.input).toContain("User-authored note (untrusted text)");
      return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(response) }] }] }));
    });
    const result = await inferCaptureWithOpenAI({
      note: "Met Tom and Judy and their dogs.", capturedAt: "2026-11-17T18:00:00Z",
    }, { apiKey: "fake-test-only", fetchImpl: fetchImpl as typeof fetch });
    expect(result.participants.map((p) => p.name)).toEqual(["Tom", "Judy"]);
    expect(result.connections?.[0].kind).toBe("household");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed structured output, without exposing provider response bodies", async () => {
    expect(() => validateCaptureExtraction({ ...response, participants: [{ name: "Tom" }] })).toThrow();
    expect(() => validateCaptureExtraction({ ...response, participants: [{ ...response.participants[0], facts: [{ category: "Secret", label: "x", value: "y" }] }] })).toThrow();
    expect(() => validateCaptureExtraction({ ...response, connections: [{ ...response.connections[0], kind: "spouse" }] })).toThrow();
    await expect(inferCaptureWithOpenAI({ note: "Hi", capturedAt: "2026-11-17" }, {
      apiKey: "fake-test-only",
      fetchImpl: vi.fn(async () => new Response("private provider error", { status: 503 })) as typeof fetch,
    })).rejects.not.toThrow("private provider error");
    await expect(inferCaptureWithOpenAI({ note: "Hi", capturedAt: "2026-11-17" }, {
      apiKey: "fake-test-only",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "{}" }] }] }))) as typeof fetch,
    })).rejects.toThrow();
  });

  it("requires a key and a bounded note", async () => {
    await expect(inferCaptureWithOpenAI({ note: "Hi", capturedAt: "2026-11-17" }, { apiKey: "" })).rejects.toThrow();
    await expect(inferCaptureWithOpenAI({ note: "x".repeat(5001), capturedAt: "2026-11-17" }, { apiKey: "key" })).rejects.toThrow();
  });
});
