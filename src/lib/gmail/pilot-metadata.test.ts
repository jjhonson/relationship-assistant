import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aliasCandidatesFromMetadata,
  fetchPilotAliasMetadata,
  fetchPilotThreadMetadata,
  PILOT_ALIAS_MESSAGE_LIMIT,
  PILOT_THREAD_MESSAGE_LIMIT,
  threadCandidatesFromMetadata,
  type PilotMetadataMessage,
} from "./pilot-metadata";

afterEach(() => vi.unstubAllGlobals());

function metadataMessage(
  id: string,
  threadId: string,
  date: string,
  from: string,
  to: string,
  subject = "Hello",
  cc = "",
): PilotMetadataMessage {
  return {
    id,
    threadId,
    internalDate: String(Date.parse(date)),
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        ...(cc ? [{ name: "Cc", value: cc }] : []),
        { name: "Date", value: date },
        { name: "Subject", value: subject },
      ],
    },
  };
}

describe("real-contact Gmail metadata interpretation", () => {
  it("keeps multiple addresses for the same displayed person separate until the user confirms them", () => {
    const messages = [
      metadataMessage(
        "m1",
        "t1",
        "2026-01-01T12:00:00Z",
        "Kate Morgan <kate@old.example.test>",
        "Owner <owner@example.test>",
      ),
      metadataMessage(
        "m2",
        "t2",
        "2026-02-01T12:00:00Z",
        "Owner <owner@example.test>",
        "Kate Morgan <kate@new.example.test>",
      ),
      metadataMessage(
        "m3",
        "t3",
        "2026-03-01T12:00:00Z",
        "Different Kate <other.kate@example.test>",
        "Owner <owner@example.test>",
      ),
    ];

    expect(aliasCandidatesFromMetadata(messages, "Kate", ["owner@example.test"])).toEqual([
      {
        address: "kate@new.example.test",
        displayName: "Kate Morgan",
        observedMessageCount: 1,
      },
      {
        address: "kate@old.example.test",
        displayName: "Kate Morgan",
        observedMessageCount: 1,
      },
      {
        address: "other.kate@example.test",
        displayName: "Different Kate",
        observedMessageCount: 1,
      },
    ]);
  });

  it("excludes the account owner and addresses unrelated to the searched name", () => {
    const messages = [
      metadataMessage(
        "m1",
        "t1",
        "2026-01-01T12:00:00Z",
        "Owner Kate <owner@example.test>",
        "Alex <alex@example.test>",
      ),
      metadataMessage(
        "m2",
        "t2",
        "2026-02-01T12:00:00Z",
        "Alex <alex@example.test>",
        "Owner <owner@example.test>",
      ),
    ];

    expect(aliasCandidatesFromMetadata(messages, "Kate", ["owner@example.test"])).toEqual([]);
  });

  it("groups exact confirmed-alias matches into thread candidates and ignores false search positives", () => {
    const messages = [
      metadataMessage(
        "m1",
        "t1",
        "2026-01-01T12:00:00Z",
        "Kate <kate@old.example.test>",
        "Owner <owner@example.test>",
        "Career update",
      ),
      metadataMessage(
        "m2",
        "t1",
        "2026-01-03T12:00:00Z",
        "Owner <owner@example.test>",
        "Kate <kate@old.example.test>",
        "Re: Career update",
      ),
      metadataMessage(
        "m3",
        "t2",
        "2026-02-01T12:00:00Z",
        "Google alias expansion <not-kate@example.test>",
        "Owner <owner@example.test>",
        "Should not appear",
      ),
    ];

    expect(threadCandidatesFromMetadata(messages, ["kate@old.example.test"])).toEqual([
      {
        id: "t1",
        subject: "Career update",
        firstDate: "2026-01-01",
        lastDate: "2026-01-03",
        messageCount: 2,
        participantAddresses: ["kate@old.example.test", "owner@example.test"],
      },
    ]);
  });
});

describe("bounded Gmail metadata network calls", () => {
  it("looks up a person by header-scoped name search and fetches metadata only", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);

      if (url.pathname.endsWith("/messages")) {
        return new Response(
          JSON.stringify({
            messages: Array.from({ length: 2 }, (_, index) => ({
              id: `m${index}`,
              threadId: `t${index}`,
            })),
            nextPageToken: "more",
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          id: url.pathname.split("/").pop(),
          internalDate: String(Date.parse("2026-01-01T12:00:00Z")),
          payload: {
            headers: [
              { name: "From", value: "Kate <kate@example.test>" },
              { name: "To", value: "Owner <owner@example.test>" },
            ],
          },
        }),
        { status: 200 },
      );
    }));

    const result = await fetchPilotAliasMetadata("fake-token", "Kate");
    expect(result.messages).toHaveLength(2);
    expect(result.truncated).toBe(true);

    const list = urls.find((url) => url.pathname.endsWith("/messages"))!;
    expect(list.searchParams.get("maxResults")).toBe(String(PILOT_ALIAS_MESSAGE_LIMIT));
    const query = list.searchParams.get("q") ?? "";
    expect(query).toContain('from:"Kate"');
    expect(query).toContain('to:"Kate"');
    expect(query).toContain('cc:"Kate"');
    expect(query).toContain("-in:drafts");

    const details = urls.filter((url) => /\/messages\/[^/]+$/.test(url.pathname));
    expect(details).toHaveLength(2);
    expect(details.every((url) => url.searchParams.get("format") === "metadata")).toBe(true);
    expect(details.every((url) => !(url.searchParams.get("fields") ?? "").includes("snippet"))).toBe(true);
    expect(details.every((url) => !(url.searchParams.get("fields") ?? "").includes("body"))).toBe(true);
    expect(details.every((url) => url.searchParams.getAll("metadataHeaders").includes("From"))).toBe(true);
    expect(details.every((url) => !url.searchParams.getAll("metadataHeaders").includes("Subject"))).toBe(true);
  });

  it("uses confirmed aliases for one bounded metadata-only thread search", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith("/messages")) {
        return new Response(JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: "m1",
          threadId: "t1",
          internalDate: String(Date.parse("2026-01-01T12:00:00Z")),
          payload: { headers: [] },
        }),
        { status: 200 },
      );
    }));

    await fetchPilotThreadMetadata("fake-token", [
      "kate@old.example.test",
      "kate@new.example.test",
    ]);

    const list = urls.find((url) => url.pathname.endsWith("/messages"))!;
    expect(list.searchParams.get("maxResults")).toBe(String(PILOT_THREAD_MESSAGE_LIMIT));
    const query = list.searchParams.get("q") ?? "";
    expect(query).toContain("from:kate@old.example.test");
    expect(query).toContain("to:kate@new.example.test");
    expect(query).toContain("-in:drafts");

    const detail = urls.find((url) => /\/messages\/[^/]+$/.test(url.pathname))!;
    expect(detail.searchParams.get("format")).toBe("metadata");
    expect(detail.searchParams.getAll("metadataHeaders")).toContain("Subject");
    expect(detail.searchParams.get("fields")).not.toContain("snippet");
    expect(detail.searchParams.get("fields")).not.toContain("body");
  });

  it("rejects query-shaped person labels and malformed aliases before calling Gmail", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      fetchPilotAliasMetadata("fake-token", 'Kate"} OR in:anywhere'),
    ).rejects.toThrow();

    await expect(
      fetchPilotThreadMetadata("fake-token", ["a b@example.test) OR in:anywhere"]),
    ).rejects.toThrow();

    expect(fetch).not.toHaveBeenCalled();
  });
});
