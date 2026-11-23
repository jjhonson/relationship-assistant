import { describe, expect, it } from "vitest";
import {
  addConnectionEvent, connectionEventLabel, connectionStatus,
  makeConnectionJourney, validPastDate,
} from "./connection-journey";

const now = new Date("2026-11-23T18:00:00Z");

describe("confirmed one-to-one connection activity", () => {
  it("starts as considering, without recording a sent message or reply", () => {
    const journey = makeConnectionJourney("tom", "Share an article with Tom", {
      basisId: "fact:guitar", basisSourceIds: ["s1", "s1", "s2"],
    }, now);
    expect(journey.events).toEqual([]);
    expect(journey.basisSourceIds).toEqual(["s1", "s2"]);
    expect(connectionStatus(journey)).toBe("considering");
    expect(connectionEventLabel("considering")).toBe("Considering");
  });

  it("tracks prepared, sent, reply, and occurred as different confirmed events", () => {
    let journal = makeConnectionJourney("tom", "Share an article", {}, now);
    const add = (kind: "prepared" | "sent" | "reply_received" | "interaction_occurred", summary: string, outcome = "") => {
      journal = addConnectionEvent(journal, {
        kind, happenedOn: "2026-11-23", summary, outcome,
      }, "2026-11-23", now).journey;
    };
    add("prepared", "I drafted an email.");
    expect(connectionStatus(journal)).toBe("prepared");
    expect(journal.events[0].kind).toBe("prepared");
    add("sent", "I sent Tom the article.");
    expect(connectionStatus(journal)).toBe("sent");
    add("reply_received", "Tom replied.", "Tom hopes to perform at an open mic someday.");
    expect(connectionStatus(journal)).toBe("reply_received");
    add("interaction_occurred", "We talked about the guitar lesson.");
    expect(connectionStatus(journal)).toBe("interaction_occurred");
    expect(journal.events).toHaveLength(4);
    expect(journal.events[0].summary).toBe("I drafted an email.");
    expect(journal.events[2].outcome).toContain("hopes");
  });

  it("does not treat a scheduled future meeting as already completed", () => {
    const journal = makeConnectionJourney("tom", "Plan coffee", {}, now);
    const next = addConnectionEvent(journal, {
      kind: "meeting_scheduled", happenedOn: "2026-11-23",
      summary: "We scheduled coffee for December 3.", outcome: "",
    }, "2026-11-23", now).journey;
    expect(connectionStatus(next)).toBe("meeting_scheduled");
    expect(connectionEventLabel(connectionStatus(next))).toContain("not completed");
    expect(next.events).toHaveLength(1);
  });

  it("accepts only real past/current dates, never fabricated future occurrence dates", () => {
    expect(validPastDate("2026-11-23", "2026-11-23")).toBe(true);
    expect(validPastDate("2026-11-24", "2026-11-23")).toBe(false);
    expect(validPastDate("2026-02-30", "2026-11-23")).toBe(false);
    expect(validPastDate("11/23/2026", "2026-11-23")).toBe(false);
    const journal = makeConnectionJourney("tom", "Coffee", {}, now);
    expect(() => addConnectionEvent(journal, {
      kind: "interaction_occurred", happenedOn: "2026-11-24",
      summary: "Had coffee tomorrow.", outcome: "",
    }, "2026-11-23")).toThrow(/date/i);
  });

  it("rejects blank and oversized material", () => {
    expect(() => makeConnectionJourney("tom", "")).toThrow(/subject/i);
    const journal = makeConnectionJourney("tom", "Article");
    expect(() => addConnectionEvent(journal, {
      kind: "sent", happenedOn: "2026-11-23",
      summary: "", outcome: "",
    }, "2026-11-23")).toThrow(/summary/i);
  });
});
