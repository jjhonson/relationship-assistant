import { describe, expect, it } from "vitest";
import { planHomeCapture, reportedConversationDay } from "./home-direct-capture";
import type { CaptureInterpretation } from "./conversational-capture";

const today = "2026-11-25"; // America/Denver, even if UTC server is already Nov 26.
const people = [
  { id: "judy", label: "Fictional Judy Test" },
  { id: "tom-1", label: "Tom Wilson" },
  { id: "tom-2", label: "Tom Sawyer" },
];
const note: CaptureInterpretation = {
  kind: "note", source: "unspecified", interactionDate: "",
  dateEvidence: "unknown", question: "", summary: "User-authored note",
};

describe("one-step Home capture planning", () => {
  it("saves an unambiguous authored Judy note without asking for review and preserves yesterday", () => {
    const text = "I spoke with Fictional Judy Test yesterday. She's thinking about her first 5K in December but hasn't registered.";
    expect(planHomeCapture({ text, interpretation: note, people, today })).toMatchObject({
      state: "ready", kind: "note", relationshipId: "judy",
      interactionDate: "2026-11-24", source: "unspecified",
    });
  });

  it("never turns a person's future milestone into the user's past interaction", () => {
    expect(reportedConversationDay("Judy plans to run tomorrow.", today)).toBe("");
    expect(reportedConversationDay("I read an article today about running.", today)).toBe("");
    expect(reportedConversationDay("I spoke with Judy today. She plans to run in December.", today))
      .toBe("2026-11-25");
    expect(reportedConversationDay("I spoke with Judy yesterday. Her race may happen tomorrow.", today))
      .toBe("2026-11-24");
    expect(reportedConversationDay("Yesterday, I spoke with Judy about the race.", today))
      .toBe("2026-11-24");
    expect(reportedConversationDay("I spoke with Judy about her race today.", today)).toBe("");
    expect(reportedConversationDay("I spoke with Judy because she raced yesterday.", today)).toBe("");
    expect(reportedConversationDay("I spoke with Judy; she ran yesterday.", today)).toBe("");
  });

  it("rolls over at month and year boundaries using local calendar day", () => {
    expect(reportedConversationDay("I met Judy yesterday.", "2027-01-01")).toBe("2026-12-31");
    expect(reportedConversationDay("I caught up with Judy yesterday.", "2026-03-01")).toBe("2026-02-28");
  });

  it("asks about authorship if a model mistakes a first-person recap for pasted dialogue", () => {
    const text = "I spoke with Fictional Judy Test yesterday. She may try a 5K.";
    const wrong = { ...note, kind: "conversation" as const,
      source: "meeting" as const, interactionDate: "2026-11-24",
      dateEvidence: "relative" as const };
    expect(planHomeCapture({ text, interpretation: wrong, people, today }))
      .toMatchObject({ state: "clarify", field: "kind" });
    expect(planHomeCapture({ text, interpretation: wrong, people, today,
      choices: { kind: "note" },
    })).toMatchObject({ state: "ready", kind: "note",
      relationshipId: "judy", interactionDate: "2026-11-24" });
  });

  it("saves a private moment without relating it to people mentioned incidentally", () => {
    expect(planHomeCapture({
      text: "I read a great article about preparing for a 5K.",
      interpretation: { ...note, kind: "moment" }, people, today,
    })).toMatchObject({
      state: "ready", kind: "moment", relationshipId: "", interactionDate: "",
    });
  });

  it("uses the relationship-page person when the note does not name anyone", () => {
    const text = "She is thinking about joining a running group.";
    expect(planHomeCapture({ text, interpretation: note, people, today,
      contextRelationshipId: "judy" })).toMatchObject({
        state: "ready", kind: "note", relationshipId: "judy",
      });
    expect(planHomeCapture({ text, interpretation: { ...note, kind: "conversation",
      source: "messages" }, people, today, contextRelationshipId: "judy" }))
      .toMatchObject({ state: "clarify", field: "date", kind: "conversation" });
  });

  it("asks instead of assigning a different named person to the open profile", () => {
    const text = "I met Tom Wilson yesterday.";
    const result = planHomeCapture({ text, interpretation: note, people, today,
      contextRelationshipId: "judy" });
    expect(result).toMatchObject({ state: "clarify", field: "person", kind: "note" });
    expect(planHomeCapture({ text, interpretation: note, people, today,
      contextRelationshipId: "judy", choices: { relationshipId: "tom-1" } }))
      .toMatchObject({ state: "ready", relationshipId: "tom-1",
        interactionDate: "2026-11-24" });
    expect(planHomeCapture({ text, interpretation: note, people, today,
      contextRelationshipId: "judy", choices: { relationshipId: "judy" } }))
      .toMatchObject({ state: "ready", relationshipId: "judy" });
  });

  it("handles explicit names and invalid page context without silent identity merging", () => {
    const text = "I spoke with Fictional Judy Test yesterday.";
    expect(planHomeCapture({ text, interpretation: note, people, today,
      contextRelationshipId: "judy" })).toMatchObject({ state: "ready",
      relationshipId: "judy", interactionDate: "2026-11-24" });
    expect(() => planHomeCapture({ text, interpretation: note, people, today,
      contextRelationshipId: "missing" })).toThrow("open relationship");
    expect(planHomeCapture({ text: "I met Tom yesterday.", interpretation: note, people,
      today, contextRelationshipId: "judy" }))
      .toMatchObject({ state: "clarify", field: "person" });
    expect(planHomeCapture({ text: "I read a book yesterday.", people, today,
      interpretation: { ...note, kind: "moment" }, contextRelationshipId: "judy" }))
      .toMatchObject({ state: "ready", kind: "moment", relationshipId: "" });
  });

  it("asks only which Tom for ambiguous names and accepts a valid explicit choice", () => {
    const text = "I met Tom yesterday at a conference.";
    expect(planHomeCapture({ text, interpretation: note, people, today }))
      .toMatchObject({ state: "clarify", field: "person" });
    expect(planHomeCapture({ text, interpretation: note, people, today,
      choices: { relationshipId: "tom-2" } })).toMatchObject({
      state: "ready", kind: "note", relationshipId: "tom-2", interactionDate: "2026-11-24",
    });
    expect(() => planHomeCapture({ text, interpretation: note, people, today,
      choices: { relationshipId: "missing" } })).toThrow("no longer available");
  });

  it("clarifies authorship when model cannot distinguish input types", () => {
    const text = "An interesting thought about training.";
    const result = planHomeCapture({
      text, interpretation: { ...note, kind: "uncertain" }, people, today,
    });
    expect(result).toMatchObject({ state: "clarify", field: "kind" });
    expect(planHomeCapture({
      text, interpretation: { ...note, kind: "uncertain" }, people, today,
      choices: { kind: "moment" },
    })).toMatchObject({ state: "ready", kind: "moment" });
  });

  it("asks whose writing was imported before retaining text-file content verbatim", () => {
    const text = "I met Fictional Judy Test yesterday.";
    expect(planHomeCapture({ text, interpretation: note, people, today,
      importedTextFile: true })).toMatchObject({ state: "clarify", field: "kind" });
    expect(planHomeCapture({ text, interpretation: note, people, today,
      importedTextFile: true, choices: { kind: "note" } })).toMatchObject({
      state: "ready", kind: "note", relationshipId: "judy",
    });
    const dialogue = "Judy: I may run a 5K.\nMe: Interesting.";
    expect(planHomeCapture({ text: dialogue, people, today,
      importedTextFile: true,
      interpretation: { ...note, kind: "conversation", source: "messages" },
      choices: { relationshipId: "judy", interactionDate: "2026-11-24" } })).toMatchObject({
      state: "ready", kind: "conversation",
    });
  });

  it("recognizes pasted third-party messages even when the model or user calls them a note", () => {
    const text = "Tom: I haven't signed up for the race.\nMe: Got it.";
    const result = planHomeCapture({
      text, interpretation: note, people, today, choices: { kind: "note", relationshipId: "tom-1" },
    });
    expect(result).toMatchObject({ state: "clarify", field: "date" });
    // Raw pasted dialogue must never be persisted through the user-note path.
    expect(result.state === "ready" && result.kind === "note").toBe(false);
  });

  it("asks for a date before saving pasted conversations without reliable timestamps", () => {
    const text = "Judy: I may try the 5K.\nMe: Interesting.";
    expect(planHomeCapture({
      text, interpretation: { ...note, kind: "conversation", source: "messages" }, people, today,
      choices: { relationshipId: "judy" },
    })).toMatchObject({ state: "clarify", field: "date" });
    expect(planHomeCapture({
      text, interpretation: { ...note, kind: "conversation", source: "messages" }, people, today,
      choices: { relationshipId: "judy", interactionDate: "2026-11-24" },
    })).toMatchObject({ state: "ready", kind: "conversation", interactionDate: "2026-11-24" });
  });

  it("rejects impossible and future dates rather than fabricating interactions", () => {
    for (const invalid of ["2026-02-30", "2027-01-01", "2026-11-26"]) {
      expect(() => planHomeCapture({
        text: "Judy: Hello.\nMe: Hi.", interpretation: { ...note, kind: "conversation" },
        people, today, choices: { relationshipId: "judy", interactionDate: invalid },
      })).toThrow("valid past");
    }
  });

  it("never silently creates a person for an unrecognized name", () => {
    const text = "I met Alex yesterday.";
    expect(planHomeCapture({ text, interpretation: note, people, today }))
      .toMatchObject({ state: "clarify", field: "person" });
    expect(planHomeCapture({ text, interpretation: note, people, today,
      choices: { relationshipId: "__new__" },
    })).toMatchObject({ state: "ready", kind: "note", relationshipId: "" });
  });
});


describe("conversation with a new person", () => {
  const input = { text: "Morgan: I have started a fictional project.\nMe: Interesting.",
    interpretation: { ...note, kind: "conversation" as const, source: "meeting" as const },
    people: [], today };
  it("asks for a person, then the actual date, without requiring a separate profile", () => {
    expect(planHomeCapture(input)).toMatchObject({ state: "clarify", field: "person" });
    expect(planHomeCapture({ ...input, choices: { relationshipId: "__new__" } }))
      .toMatchObject({ state: "clarify", field: "person" });
    expect(planHomeCapture({ ...input, choices: { relationshipId: "__new__", newPersonLabel: "Fictional Morgan" } }))
      .toMatchObject({ state: "clarify", field: "date" });
    expect(planHomeCapture({ ...input, choices: { relationshipId: "__new__", newPersonLabel: "Fictional Morgan",
      interactionDate: "2026-11-24" } }))
      .toMatchObject({ state: "ready", kind: "conversation", relationshipId: "", interactionDate: "2026-11-24" });
  });
});
