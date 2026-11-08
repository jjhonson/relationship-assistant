import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchApprovedPilotContent,
  MAX_REAL_PILOT_MESSAGE_CHARS,
  minimizePilotMessageText,
} from "./pilot-content";

afterEach(() => vi.unstubAllGlobals());

function enc(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

const selection = {
  source: "gmail" as const,
  personLabel: "Kate",
  confirmedIdentityKeys: ["kate@example.test"],
  selectedConversationIds: ["thread-1"],
};

describe("approved Gmail pilot content", () => {
  it("adapts only approved Gmail conversations into canonical messages and ignores attachments", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      const threadId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return new Response(JSON.stringify({
        id: threadId,
        messages: [{
          id: "m1",
          threadId,
          internalDate: String(Date.parse("2026-11-01T12:00:00Z")),
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "From", value: "Kate <kate@example.test>" },
              { name: "To", value: "Owner <owner@example.test>" },
              { name: "Subject", value: "Catch up" },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: enc("Great talking.\n\nOn Fri, someone wrote:\n> old quoted text") },
              },
              {
                mimeType: "application/pdf",
                filename: "private.pdf",
                body: { attachmentId: "att-1", size: 12345 },
              },
            ],
          },
        }],
      }), { status: 200 });
    }));

    const result = await fetchApprovedPilotContent("token", selection);

    expect(result.source).toBe("gmail");
    expect(result.messageCount).toBe(1);
    expect(result.sourceConversationIds).toEqual(["thread-1"]);
    expect(result.messages).toEqual([{
      id: "gmail:thread-1:m1",
      source: "gmail",
      conversationId: "thread-1",
      date: "2026-11-01",
      from: "Kate <kate@example.test>",
      to: "Owner <owner@example.test>",
      subject: "Catch up",
      body: "Great talking.",
    }]);

    expect(urls).toHaveLength(1);
    expect(urls[0].pathname).toContain("/threads/thread-1");
    expect(urls[0].searchParams.get("format")).toBe("full");
    expect(urls.every((url) => !url.pathname.includes("/attachments/"))).toBe(true);
  });

  it("rejects a conversation that no longer includes a confirmed identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        id: "thread-1",
        messages: [{
          id: "m1",
          threadId: "thread-1",
          internalDate: String(Date.now()),
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "Other <other@example.test>" },
              { name: "To", value: "Owner <owner@example.test>" },
            ],
            body: { data: enc("hello") },
          },
        }],
      }), { status: 200 }),
    ));

    await expect(fetchApprovedPilotContent("token", selection)).rejects.toThrow("no longer includes");
  });

  it("rejects non-Gmail selections at the Gmail adapter boundary", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(fetchApprovedPilotContent("token", {
      ...selection,
      source: "sms",
    })).rejects.toThrow("only retrieve Gmail conversations");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to inline HTML text but never follows attachment IDs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        id: "thread-1",
        messages: [{
          id: "m1",
          threadId: "thread-1",
          internalDate: String(Date.parse("2026-11-01T12:00:00Z")),
          payload: {
            mimeType: "multipart/alternative",
            headers: [
              { name: "From", value: "Kate <kate@example.test>" },
              { name: "To", value: "Owner <owner@example.test>" },
              { name: "Subject", value: "HTML only" },
            ],
            parts: [
              {
                mimeType: "text/html",
                body: { data: enc("<p>Hello <b>Jason</b></p><p>Good to reconnect.</p>") },
              },
            ],
          },
        }],
      }), { status: 200 }),
    ));

    const result = await fetchApprovedPilotContent("token", selection);

    expect(result.messages[0].body).toContain("Hello Jason");
    expect(result.messages[0].body).toContain("Good to reconnect.");
  });

  it("removes common quoted history and caps each message", () => {
    expect(minimizePilotMessageText("New reply\n\n> quoted\n> text")).toBe("New reply");
    expect(minimizePilotMessageText("New reply\n\n-----Original Message-----\nOld")).toBe("New reply");
    expect(minimizePilotMessageText("x".repeat(MAX_REAL_PILOT_MESSAGE_CHARS + 50))).toHaveLength(
      MAX_REAL_PILOT_MESSAGE_CHARS,
    );
  });
});
