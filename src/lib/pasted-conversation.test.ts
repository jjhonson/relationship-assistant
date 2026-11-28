import { describe, expect, it } from "vitest";
import { PASTED_CONVERSATION_SOURCES, parsePastedConversation } from "./pasted-conversation";

describe("manual conversation paste", () => {
  const base = { transcript: "  Tom: Practicing guitar this week.  ", interactionDate: "2026-11-20" };

  it("accepts each explicit channel and labels it as user-pasted, not verified", () => {
    expect(PASTED_CONVERSATION_SOURCES.map((source) => source.value)).toEqual([
      "meeting", "email", "messages", "notes", "unspecified",
    ]);
    for (const source of PASTED_CONVERSATION_SOURCES) {
      const parsed = parsePastedConversation({ ...base, source: source.value });
      expect(parsed).toEqual({
        transcript: "Tom: Practicing guitar this week.",
        interactionDate: "2026-11-20",
        sourceLabel: source.provenanceLabel,
      });
      expect(parsed.sourceLabel).toContain("Manually pasted");
    }
  });

  it("preserves user-reported direction of explicitly sent email without claiming verified import",()=>{
    expect(parsePastedConversation({transcript:"Email I sent on Nov 19th to Robin:\nCould we discuss the proposal?",interactionDate:"2026-11-19",source:"email"}).sourceLabel).toBe("Manually pasted sent email");
    expect(parsePastedConversation({transcript:"Email from Robin on Nov 20:\nThanks.",interactionDate:"2026-11-20",source:"email"}).sourceLabel).toBe("Manually pasted email conversation");
  });
  it("rejects unknown or forged sources instead of presenting them as verified", () => {
    for (const source of ["gmail", "LinkedIn imported", "<script>", "", null]) {
      expect(() => parsePastedConversation({ ...base, source })).toThrow("Choose where");
    }
  });

  it("rejects blank text, overly large content, and invalid dates before inference", () => {
    expect(() => parsePastedConversation({ ...base, transcript: " ", source: "meeting" })).toThrow();
    expect(() => parsePastedConversation({ ...base, transcript: "x".repeat(80_001), source: "meeting" })).toThrow();
    expect(parsePastedConversation({ ...base, transcript: "x".repeat(80_000), source: "meeting" }).transcript).toHaveLength(80_000);
    for (const interactionDate of ["", "2026-02-30", "yesterday", "2026-11-1"]) {
      expect(() => parsePastedConversation({ ...base, interactionDate, source: "email" })).toThrow("valid conversation date");
    }
  });
});
