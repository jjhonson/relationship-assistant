import { afterEach, describe, expect, it, vi } from "vitest";
import { planPersonImport, type PersonImportScope } from "./person-import";
import { minimizePersonImportText, retrievePersonImportContent } from "./person-import-content";
import type { PilotMetadataMessage } from "./pilot-metadata";

afterEach(() => vi.unstubAllGlobals());

const scope: PersonImportScope = {
  personId: "person-fixture",
  mailboxAddress: "owner@example.test",
  confirmedAddresses: ["alex@example.test"],
};
const threadId = "fixture-thread";
const enc = (body: string) => Buffer.from(body).toString("base64url");

function metadata(id: string, sent = false, day = 2): PilotMetadataMessage & { sizeEstimate: number } {
  return {
    id, threadId, internalDate: String(Date.UTC(2026, 10, day, 23, 12)), sizeEstimate: 900,
    labelIds: [sent ? "SENT" : "INBOX"],
    payload: { headers: [
      { name: "From", value: sent ? "owner@example.test" : "alex@example.test" },
      { name: "To", value: sent ? "alex@example.test" : "owner@example.test" },
      { name: "Subject", value: "Catch up" },
    ] },
  };
}
function full(item: ReturnType<typeof metadata>, text: string) {
  return { ...item, payload: { ...item.payload, mimeType: "text/plain", body: { data: enc(text) } } };
}
function candidates(...items: PilotMetadataMessage[]) {
  return planPersonImport(scope, { messages: items, truncated: false }).candidates;
}
function mockedProvider(
  items: ReturnType<typeof metadata>[],
  bodies: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  mailbox = scope.mailboxAddress,
) {
  const urls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname.endsWith("/profile")) return new Response(JSON.stringify({ emailAddress: mailbox }));
    const id = url.pathname.split("/").pop() ?? "";
    const item = items.find((value) => value.id === id);
    if (!item || !url.pathname.includes("/messages/")) throw new Error("Unexpected provider request");
    const format = url.searchParams.get("format");
    if (format === "metadata") return new Response(JSON.stringify(overrides[id] ?? item));
    if (format === "full") return new Response(JSON.stringify(bodies[id] ?? full(item, "hello")));
    throw new Error("Unexpected request format");
  }));
  return urls;
}

describe("person-scoped Gmail content retrieval", () => {
  it("reads only selected individual messages, rechecking headers first; retains provider time and direction", async () => {
    const first = metadata("sent", true, 1);
    const second = metadata("reply", false, 2);
    const unrelated = metadata("not-selected");
    const urls = mockedProvider([first, second, unrelated], {
      sent: full(first, "Here is the promised update."),
      reply: full(second, "Thank you!\n\nOn Friday, Owner wrote:\n> Here is the promised update."),
    });
    const result = await retrievePersonImportContent("fictional-token", scope, candidates(second, first).reverse());
    expect(result.messages.map(({ messageId, direction, body, observedAt, quotedHistoryRemoved }) =>
      [messageId, direction, body, observedAt, quotedHistoryRemoved])).toEqual([
      ["sent", "sent", "Here is the promised update.", "2026-11-01T23:12:00.000Z", false],
      ["reply", "received", "Thank you!", "2026-11-02T23:12:00.000Z", true],
    ]);
    expect(result.skipped).toEqual([]);
    expect(urls.map((url) => [url.pathname.split("/").pop(), url.searchParams.get("format")])).toEqual([
      ["profile", null], ["sent", "metadata"], ["sent", "full"], ["reply", "metadata"], ["reply", "full"],
    ]);
    expect(urls.every((url) => !url.pathname.includes("/threads/") && !url.pathname.includes("/attachments/"))).toBe(true);
  });

  it("rejects malformed selections and duplicate identities before provider calls", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const [item] = candidates(metadata("a"));
    await expect(retrievePersonImportContent("fixture", scope, [item, item])).rejects.toThrow("duplicate");
    await expect(retrievePersonImportContent("fixture", scope, [{ ...item, providerKey: "wrong" }])).rejects.toThrow("Invalid");
    await expect(retrievePersonImportContent("fixture", scope, [{ ...item, messageId: "../threads" }])).rejects.toThrow("Invalid");
    await expect(retrievePersonImportContent("fixture", scope, [])).rejects.toThrow("bounded");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops before reading any bodies when the connected mailbox has changed", async () => {
    const item = metadata("a");
    const urls = mockedProvider([item], {}, {}, "other@example.test");
    await expect(retrievePersonImportContent("fixture", scope, candidates(item))).rejects.toThrow("does not match");
    expect(urls).toHaveLength(1);
  });

  it("skips changed preflight metadata and over-limit messages without reading full content", async () => {
    const changed = metadata("changed");
    const big = metadata("big");
    const urls = mockedProvider([changed, big], {}, {
      changed: { ...changed, labelIds: ["DRAFT"] },
      big: { ...big, sizeEstimate: 700 * 1024 },
    });
    const result = await retrievePersonImportContent("fixture", scope, candidates(changed, big));
    expect(result.messages).toEqual([]);
    expect(result.skipped.map((item) => item.reason).sort()).toEqual(["changed-metadata", "size-limit"]);
    expect(urls.some((url) => url.searchParams.get("format") === "full")).toBe(false);
  });

  it("does not pass changed full-message content through even when the metadata had matched", async () => {
    const item = metadata("changed");
    mockedProvider([item], { changed: full({ ...item, threadId: "other-thread" }, "private unrelated text") });
    const result = await retrievePersonImportContent("fixture", scope, candidates(item));
    expect(result.messages).toEqual([]);
    expect(result.skipped[0].reason).toBe("changed-metadata");
    expect(JSON.stringify(result)).not.toContain("private unrelated text");
  });

  it("ignores attachments and embedded forwarded content; marks HTML-only and calendar messages as skipped", async () => {
    const direct = metadata("direct");
    const html = metadata("html");
    const calendar = metadata("calendar");
    const multi = metadata("multi");
    const urls = mockedProvider([direct, html, calendar, multi], {
      direct: { ...direct, payload: { ...direct.payload, mimeType: "multipart/mixed", parts: [
        { mimeType: "text/plain", body: { data: enc("Direct message.") } },
        { mimeType: "text/plain", filename: "private.txt", body: { data: enc("private attachment") } },
        { mimeType: "message/rfc822", parts: [{ mimeType: "text/plain", body: { data: enc("forwarded message") } }] },
        { mimeType: "text/plain", headers: [{ name: "Content-Disposition", value: "attachment" }], body: { data: enc("inline attachment") } },
      ] } },
      html: { ...html, payload: { ...html.payload, mimeType: "text/html", body: { data: enc("<p>HTML only</p>") } } },
      calendar: { ...calendar, payload: { ...calendar.payload, mimeType: "multipart/mixed", parts: [
        { mimeType: "text/plain", body: { data: enc("Meeting invitation") } },
        { mimeType: "text/calendar", filename: "invite.ics", body: { attachmentId: "private-id" } },
      ] } },
      multi: { ...multi, payload: { ...multi.payload, mimeType: "multipart/mixed", parts: [
        { mimeType: "text/plain", body: { data: enc("first") } },
        { mimeType: "text/plain", body: { data: enc("second") } },
      ] } },
    });
    const result = await retrievePersonImportContent("fixture", scope, candidates(direct, html, calendar, multi));
    expect(result.messages.map((item) => item.body)).toEqual(["Direct message."]);
    expect(result.skipped.map((item) => item.reason).sort()).toEqual(["calendar-artifact", "unsupported-content", "unsupported-content"]);
    expect(urls.every((url) => !url.pathname.includes("/attachments/"))).toBe(true);
  });

  it("reports per-message and batch limits rather than silently truncating evidence", async () => {
    const items = Array.from({ length: 6 }, (_, i) => metadata("m" + i, false, i + 1));
    const bodies = Object.fromEntries(items.map((item, i) => [item.id, full(item, "x".repeat(i === 0 ? 12001 : 11000))]));
    mockedProvider(items, bodies);
    const result = await retrievePersonImportContent("fixture", scope, candidates(...items));
    expect(result.messages).toHaveLength(4);
    expect(result.totalCharacters).toBeLessThanOrEqual(45000);
    expect(result.skipped.map((item) => item.reason)).toEqual(["character-limit", "batch-budget"]);
  });

  it("fails closed when a full response exceeds the byte budget", async () => {
    const item = metadata("a");
    mockedProvider([item], { a: full(item, "x".repeat(1024 * 1024)) });
    await expect(retrievePersonImportContent("fixture", scope, candidates(item))).rejects.toThrow("bounded import size");
  });

  it("conservatively removes common quoted/forwarded blocks without stitching text from them", () => {
    expect(minimizePersonImportText("New text\n\nOn Fri,\n Alex wrote:\nold text")).toEqual({ body: "New text", quotedHistoryRemoved: true });
    expect(minimizePersonImportText("Reply\nFrom: someone\nSent: Thursday\nTo: another\nold text").body).toBe("Reply");
    expect(minimizePersonImportText("Reply\n---------- Forwarded message ---------\nOld").body).toBe("Reply");
    expect(minimizePersonImportText("> quote\ninterleaved").body).toBe("");
    expect(minimizePersonImportText("Hello\n-- \nAlex").body).toBe("Hello\n--\nAlex");
  });
});
