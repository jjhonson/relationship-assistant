import { describe, expect, it } from "vitest";
import { createPersonalMoment } from "./personal-moment";

describe("intentional user-side moments", () => {
  it("saves a user's own experience and reflection without inventing endorsement", () => {
    const saved = createPersonalMoment({
      description: "Saw a long, flawed documentary.",
      reflection: "I did not enjoy the film, but its questions about how organizations gain power were interesting.",
    }, new Date("2026-11-21T17:00:00.000Z"));
    expect(saved).toMatchObject({
      description: "Saw a long, flawed documentary.",
      reflection: expect.stringContaining("did not enjoy"),
      url: "",
      consideration: "private",
      createdAt: "2026-11-21T17:00:00.000Z",
    });
    expect(saved.id).toBeTruthy();
  });

  it("preserves a combined account and personal reaction without demanding a second field", () => {
    const note = "I disliked the guitar documentary, but it got me thinking about how adults learn.";
    const saved = createPersonalMoment({ description: note }, new Date("2026-11-21T17:00:00.000Z"));
    expect(saved.description).toBe(note);
    expect(saved.reflection).toBe("");
    expect(saved.consideration).toBe("private");
    expect(createPersonalMoment({ description: "x".repeat(1500) }).description).toHaveLength(1500);
  });

  it("allows one deliberate opt-in to private, on-demand connection consideration", () => {
    const saved = createPersonalMoment({
      description: "Interesting beginner guitar tutorial",
      reflection: "The instruction was clear; I might share this with someone learning.",
      url: "https://example.org/guitar",
      consideration: "consider-people",
    });
    expect(saved.consideration).toBe("consider-people");
    expect(saved.url).toBe("https://example.org/guitar");
  });

  it("rejects invalid or credential-bearing links without fetching them", () => {
    for (const url of ["javascript:alert(1)", "file:///tmp/private.json",
      "https://user:secret@example.org/", "not a url"]) {
      expect(() => createPersonalMoment({ description: "An idea", url })).toThrow();
    }
  });

  it("requires a concise description and validates storage choices", () => {
    expect(() => createPersonalMoment({ description: "   " })).toThrow();
    expect(() => createPersonalMoment({ description: "x".repeat(3001) })).toThrow();
    expect(() => createPersonalMoment({ description: "An idea", reflection: "x".repeat(2001) })).toThrow();
    expect(() => createPersonalMoment({ description: "An idea", consideration: "everyone" as "private" })).toThrow();
  });
});
