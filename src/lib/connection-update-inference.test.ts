import { describe, expect, it } from "vitest";
import {
  interpretConnectionUpdate, validateConnectionPreview,
  CONNECTION_UPDATE_INSTRUCTIONS,
} from "./connection-update-inference";

const input = {
  text: "I sent Tom the guitar article yesterday.",
  person: "Tom", subject: "Share guitar exercise", today: "2026-11-23",
};

function mockReply(value: unknown): typeof fetch {
  return async () => new Response(JSON.stringify({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }), { status: 200 });
}

describe("explicit connection update interpretation", () => {
  it("does not confuse a prepared draft with an actual sent message", async () => {
    const result = await interpretConnectionUpdate({
      ...input, text: "I prepared a draft but have not sent it yet.",
    }, {
      apiKey: "synthetic",
      fetchImpl: mockReply({
        kind: "prepared", happenedOn: "2026-11-23",
        summary: "Draft prepared, not sent.", outcome: "", question: "",
      }),
    });
    expect(result.kind).toBe("prepared");
    expect(result.outcome).toBe("");
    expect(CONNECTION_UPDATE_INSTRUCTIONS).toMatch(/sent requires an explicit claim/);
  });

  it("uses user-confirmed past events and disables provider storage", async () => {
    let body: Record<string, unknown> = {};
    const result = await interpretConnectionUpdate(input, {
      apiKey: "synthetic", model: "synthetic-model",
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return mockReply({
          kind: "sent", happenedOn: "2026-11-22",
          summary: "Sent Tom a guitar article.", outcome: "", question: "",
        })(_url, init);
      },
    });
    expect(result.kind).toBe("sent");
    expect(result.happenedOn).toBe("2026-11-22");
    expect(body.store).toBe(false);
    expect(body.model).toBe("synthetic-model");
    expect(JSON.parse(String(body.input))).toMatchObject({ person: "Tom" });
  });

  it("does not claim a future scheduled meeting actually happened", () => {
    const result = validateConnectionPreview({
      kind: "meeting_scheduled", happenedOn: "2026-12-03",
      summary: "Meeting booked for December 3.", outcome: "", question: "",
    }, "2026-11-23");
    expect(result.happenedOn).toBe("");
  });

  it("rejects transcript-style source text without calling the model", async () => {
    await expect(interpretConnectionUpdate({
      ...input, text: "Here's the transcript:\nTom: I am learning guitar.\nMe: Interesting.",
    }, {
      apiKey: "synthetic",
      fetchImpl: async () => { throw new Error("model must not be called"); },
    })).rejects.toThrow(/pasted conversation/i);
  });

  it("never silently upgrades ambiguous plans into completed actions", () => {
    const uncertain = validateConnectionPreview({
      kind: "uncertain", happenedOn: "",
      summary: "Thinking about sending a note.", outcome: "",
      question: "Did you actually send it?",
    }, "2026-11-23");
    expect(uncertain.kind).toBe("uncertain");
    expect(uncertain.question).toContain("actually send");
    expect(() => validateConnectionPreview({
      kind: "magically-sent", happenedOn: "2026-11-23", summary: "", outcome: "", question: "",
    }, "2026-11-23")).toThrow(/Invalid/);
  });
});
