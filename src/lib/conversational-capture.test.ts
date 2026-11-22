import { describe, expect, it, vi } from "vitest";
import { interpretConversationalCapture, validateCaptureInterpretation, CONVERSATIONAL_CAPTURE_PROMPT } from "./conversational-capture";

const today = "2026-11-22";
const options = { apiKey: "fictional-key", model: "test-model" };
const base = { kind: "conversation", source: "meeting", interactionDate: today,
  dateEvidence: "relative", summary: "A meeting with Tom.", question: "" };

function mocked(value: unknown): typeof fetch {
  return async () => new Response(JSON.stringify({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }), { status: 200 });
}

describe("single-text capture preview", () => {
  it("interprets user-introduced Granola-like meeting text on explicit click without storing it", async () => {
    const fetchImpl = vi.fn(mocked(base));
    const result = await interpretConversationalCapture({
      text: "I just finished a meeting with Tom, here is the Granola transcript: Tom: Guitar is going well.",
      personLabel: "Tom (fictional)", currentDate: today,
    }, { ...options, fetchImpl });
    expect(result.kind).toBe("conversation");
    expect(result.source).toBe("meeting");
    expect(result.interactionDate).toBe(today);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.store).toBe(false);
    expect(body.input).toContain("selectedPerson");
    expect(body.input).toContain("Granola transcript");
    expect(body.instructions).toContain("untrusted data");
    expect(CONVERSATIONAL_CAPTURE_PROMPT).toContain("not proof of WhatsApp");
    expect(JSON.stringify(result)).not.toContain("Guitar is going well");
  });

  it("supports a dated email without assuming its provider", () => {
    expect(validateCaptureInterpretation({ ...base, source: "email",
      interactionDate: "2026-11-19", dateEvidence: "explicit",
      summary: "An email thread.", question: "" }, today).source).toBe("email");
  });

  it("asks one question for an undated chat rather than inventing today's date", () => {
    const result = validateCaptureInterpretation({
      ...base, source: "messages", interactionDate: "", dateEvidence: "unknown",
      summary: "A chat with Tom.", question: "When was this conversation?",
    }, today);
    expect(result.interactionDate).toBe("");
    expect(result.question).toContain("When");
  });

  it("distinguishes authored notes and personal moments, including negative opinions", () => {
    for (const kind of ["note", "moment", "uncertain"]) {
      const result = validateCaptureInterpretation({ ...base, kind,
        source: "unspecified", interactionDate: "", dateEvidence: "unknown",
        summary: "A personally meaningful but critical thought.", question: "" }, today);
      expect(result.kind).toBe(kind);
    }
  });

  it("rejects forged types, impossible or future dates and inconsistent retention categories", () => {
    expect(() => validateCaptureInterpretation({ ...base, kind: "delete-everything" }, today)).toThrow();
    expect(() => validateCaptureInterpretation({ ...base, interactionDate: "2026-02-30" }, today)).toThrow();
    expect(() => validateCaptureInterpretation({ ...base, interactionDate: "2027-01-01" }, today)).toThrow();
    expect(() => validateCaptureInterpretation({ ...base, kind: "note" }, today)).toThrow();
    expect(() => validateCaptureInterpretation({ ...base, interactionDate: "", dateEvidence: "relative" }, today)).toThrow();
  });

  it("never calls the provider for blank or oversized input", async () => {
    const fetchImpl = vi.fn(mocked(base));
    await expect(interpretConversationalCapture({
      text: " ", personLabel: "Tom", currentDate: today,
    }, { ...options, fetchImpl })).rejects.toThrow();
    await expect(interpretConversationalCapture({
      text: "x".repeat(80_001), personLabel: "Tom", currentDate: today,
    }, { ...options, fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
