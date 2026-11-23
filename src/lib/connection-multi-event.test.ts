import { describe, expect, it } from "vitest";
import {
  MULTI_EVENT_INSTRUCTIONS, interpretMultiEventUpdate,
  validateMultiEventPreview,
} from "./connection-multi-event";

const input = {
  text: "I sent Tom a guitar article yesterday. He replied today and hopes to play at an open mic someday.",
  person: "Fictional Tom", subject: "Share guitar article", today: "2026-11-23",
};
const proposed = {
  events: [
    { kind: "sent", happenedOn: "2026-11-22", summary: "Sent Tom the guitar article.", outcome: "", question: "" },
    { kind: "reply_received", happenedOn: "2026-11-23", summary: "Tom replied to the guitar article.",
      outcome: "Tom hopes to try an open mic someday; nothing is booked.", question: "" },
  ], question: "",
};
function mockReply(value: unknown): typeof fetch {
  return async () => new Response(JSON.stringify({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }), { status: 200 });
}

describe("one natural-language update, several user-reported events", () => {
  it("returns an ordered batch without inferring a draft or scheduled performance", async () => {
    let sent: Record<string, unknown> = {};
    const preview = await interpretMultiEventUpdate(input, {
      apiKey: "synthetic-test-key", model: "synthetic-model",
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return mockReply(proposed)(_url, init);
      },
    });
    expect(preview.events.map((item) => item.kind)).toEqual(["sent", "reply_received"]);
    expect(preview.events[0].happenedOn).toBe("2026-11-22");
    expect(preview.events[1].outcome).toContain("hopes");
    expect(preview.events).not.toContainEqual(expect.objectContaining({ kind: "prepared" }));
    expect(sent.store).toBe(false);
    expect(sent.model).toBe("synthetic-model");
    const modelInput = JSON.parse(String(sent.input));
    expect(modelInput.person).toBe("Fictional Tom");
    expect(MULTI_EVENT_INSTRUCTIONS).toContain("do not infer any unstated intermediate step");
    expect(MULTI_EVENT_INSTRUCTIONS).toContain("not the meeting taking place");
  });

  it("retains a prepared-but-unsent event without upgrading it to a send", () => {
    const result = validateMultiEventPreview({
      events: [{ kind: "prepared", happenedOn: "2026-11-23",
        summary: "Wrote a draft but did not send it.", outcome: "", question: "" }],
      question: "",
    }, "2026-11-23");
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("prepared");
  });

  it("keeps a future meeting date out of the actual scheduling action date", () => {
    const result = validateMultiEventPreview({
      events: [{ kind: "meeting_scheduled", happenedOn: "2026-12-03",
        summary: "Scheduled coffee for December 3.", outcome: "", question: "When was it scheduled?" }],
      question: "",
    }, "2026-11-23");
    expect(result.events[0].happenedOn).toBe("");
    expect(result.events[0].question).toContain("scheduled");
  });

  it("allows no event when an outreach idea is merely being considered", () => {
    const result = validateMultiEventPreview({
      events: [], question: "Did you actually send the note?",
    }, "2026-11-23");
    expect(result.events).toEqual([]);
    expect(result.question).toContain("actually send");
  });

  it("keeps a genuinely ambiguous event subject to review", () => {
    const result = validateMultiEventPreview({
      events: [{ kind: "uncertain", happenedOn: "",
        summary: "May have arranged coffee.", outcome: "", question: "Was coffee scheduled?" }],
      question: "",
    }, "2026-11-23");
    expect(result.events[0].kind).toBe("uncertain");
  });

  it("rejects more than five events and refuses invented learned context from a send", () => {
    expect(() => validateMultiEventPreview({
      events: Array.from({ length: 6 }, () => proposed.events[0]), question: "",
    }, "2026-11-23")).toThrow("Invalid activity interpretation");
    expect(() => validateMultiEventPreview({
      events: [{ ...proposed.events[0], outcome: "He registered for a race." }], question: "",
    }, "2026-11-23")).toThrow(/outcome/);
    expect(() => validateMultiEventPreview({
      events: [{ ...proposed.events[0], kind: "invented" }], question: "",
    }, "2026-11-23")).toThrow(/Invalid/);
  });

  it("rejects raw third-party transcripts before calling the provider", async () => {
    const text = "Here's the transcript:\nTom: I want to perform at an open mic.\nMe: Sounds good.";
    await expect(interpretMultiEventUpdate({ ...input, text }, {
      apiKey: "synthetic-test-key",
      fetchImpl: async () => { throw new Error("Provider must not be called"); },
    })).rejects.toThrow(/pasted conversation/);
  });

  it("rejects quoted dialogue inside a model-produced summary", () => {
    expect(() => validateMultiEventPreview({
      events: [{ ...proposed.events[1],
        summary: "Tom: I want to perform.\nMe: Great." }],
      question: "",
    }, "2026-11-23")).toThrow(/Pasted conversation/);
  });
});
