import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aliasCandidatesFromMetadata,
  fetchPilotAliasMetadata,
  fetchPilotThreadMetadata,
  PILOT_ALIAS_MESSAGE_LIMIT,
  PILOT_THREAD_LIST_REQUEST_LIMIT,
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

    expect(threadCandidatesFromMetadata(messages, ["kate@old.example.test"])).toMatchObject([
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

  it("marks calendar responses and automated mail from bounded headers", () => {
    const calendarMessages = [
      ["Accepted: synthetic invitation", "t-calendar-accepted"],
      ["Re: Declined: synthetic invitation", "t-calendar-declined"],
      ["Canceled: synthetic invitation", "t-calendar-canceled"],
      ["Tentative: synthetic invitation", "t-calendar-tentative"],
    ].map(([subject, threadId], index) =>
      metadataMessage(
        `m-calendar-${index}`,
        threadId,
        `2026-03-0${index + 1}T12:00:00Z`,
        "Owner <owner@example.test>",
        "Person A <person-a@example.test>",
        subject,
      ),
    );
    const automated = metadataMessage(
      "m-list",
      "t-list",
      "2026-03-02T12:00:00Z",
      "Person A <person-a@example.test>",
      "Owner <owner@example.test>",
      "Synthetic list update",
    );
    automated.payload?.headers?.push(
      { name: "List-Id", value: "updates.example.test" },
      { name: "Precedence", value: "bulk" },
      { name: "Auto-Submitted", value: "auto-generated" },
    );

    const candidates = threadCandidatesFromMetadata(
      [...calendarMessages, automated],
      ["person-a@example.test"],
    );
    expect(candidates.find(({ id }) => id === "t-list")).toMatchObject({
      isAutomated: true,
      isCalendarArtifact: false,
    });
    for (const id of [
      "t-calendar-tentative",
      "t-calendar-canceled",
      "t-calendar-declined",
      "t-calendar-accepted",
    ]) {
      expect(candidates.find((candidate) => candidate.id === id)).toMatchObject({
        isAutomated: false,
        isCalendarArtifact: true,
      });
    }
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

  it("uses confirmed aliases for bounded metadata-only thread sampling", async () => {
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

    const lists = urls.filter((url) => url.pathname.endsWith("/messages"));
    expect(lists).toHaveLength(PILOT_THREAD_LIST_REQUEST_LIMIT);
    expect(lists.every((list) => Number(list.searchParams.get("maxResults")) <= 3)).toBe(true);
    expect(lists.every((list) => {
      const query = list.searchParams.get("q") ?? "";
      return query.includes("from:kate@old.example.test") &&
        query.includes("to:kate@new.example.test") &&
        query.includes("-in:drafts") &&
        query.includes("after:") &&
        query.includes("before:");
    })).toBe(true);

    const detail = urls.find((url) => /\/messages\/[^/]+$/.test(url.pathname))!;
    expect(detail.searchParams.get("format")).toBe("metadata");
    expect(detail.searchParams.getAll("metadataHeaders")).toContain("Subject");
    expect(detail.searchParams.getAll("metadataHeaders")).toContain("Auto-Submitted");
    expect(detail.searchParams.get("fields")).not.toContain("snippet");
    expect(detail.searchParams.get("fields")).not.toContain("body");
  });

  it("samples bounded monthly and quarterly windows for confirmed aliases using metadata only", async () => {
    const urls: URL[] = [];
    let activeDetails = 0;
    let maximumDetails = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith("/messages")) {
        const query = url.searchParams.get("q") ?? "";
        const after = query.match(/after:(\d+)/)?.[1];
        const requestLimit = url.searchParams.get("maxResults");
        return new Response(JSON.stringify({
          messages: Array.from({ length: 5 }, (_, index) => ({
            id: `m-${requestLimit}-${after}-${index}`,
            threadId: `t-${after}-${index}`,
          })),
          nextPageToken: "more-in-window",
        }), { status: 200 });
      }

      activeDetails++;
      maximumDetails = Math.max(maximumDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeDetails--;
      return new Response(JSON.stringify({
        id: url.pathname.split("/").pop(),
        internalDate: String(Date.parse("2026-01-01T12:00:00Z")),
        payload: {
          headers: [
            { name: "From", value: "Person A <person-a@example.test>" },
            { name: "To", value: "Owner <owner@example.test>" },
          ],
        },
      }), { status: 200 });
    }));

    const result = await fetchPilotThreadMetadata(
      "fake-token",
      ["person-a@example.test", "person-a@archive.example.test"],
      new Date("2026-06-15T00:00:00Z"),
    );

    const listUrls = urls.filter((url) => url.pathname.endsWith("/messages"));
    const detailUrls = urls.filter((url) => /\/messages\/[^/]+$/.test(url.pathname));
    expect(listUrls).toHaveLength(PILOT_THREAD_LIST_REQUEST_LIMIT);
    expect(detailUrls).toHaveLength(PILOT_THREAD_MESSAGE_LIMIT);
    expect(result.messages).toHaveLength(PILOT_THREAD_MESSAGE_LIMIT);
    expect(result.stats).toEqual({
      listRequests: PILOT_THREAD_LIST_REQUEST_LIMIT,
      listRecordsReturned: 120,
      detailRequests: PILOT_THREAD_MESSAGE_LIMIT,
      windowsQueried: PILOT_THREAD_LIST_REQUEST_LIMIT,
      monthWindowsQueried: 30,
      quarterWindowsQueried: 30,
      recordsReturned: PILOT_THREAD_MESSAGE_LIMIT,
    });
    expect(result.truncated).toBe(true);
    expect(maximumDetails).toBeLessThanOrEqual(5);

    const queries = listUrls.map((url) => url.searchParams.get("q") ?? "");
    expect(queries.every((query) =>
      query.includes("from:person-a@example.test") &&
      query.includes("to:person-a@example.test") &&
      query.includes("cc:person-a@example.test") &&
      query.includes("from:person-a@archive.example.test") &&
      query.includes("to:person-a@archive.example.test") &&
      query.includes("cc:person-a@archive.example.test") &&
      query.includes("-in:drafts"),
    )).toBe(true);
    const sampleYears = queries.flatMap((query) => {
      const after = Number(query.match(/after:(\d+)/)?.[1]);
      return Number.isFinite(after) ? [new Date(after * 1000).getUTCFullYear()] : [];
    });
    expect(Math.max(...sampleYears) - Math.min(...sampleYears)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...sampleYears) - Math.min(...sampleYears)).toBeLessThanOrEqual(10);
    const detailIds = new Set(detailUrls.map((url) => url.pathname.split("/").pop()));
    const monthlyAfterValues = listUrls
      .filter((url) => url.searchParams.get("maxResults") === "1")
      .map((url) => url.searchParams.get("q")?.match(/after:(\d+)/)?.[1]);
    expect(monthlyAfterValues).toHaveLength(30);
    expect(monthlyAfterValues.every((after) => detailIds.has(`m-1-${after}-0`))).toBe(true);
    const quarterlyAfterValues = listUrls
      .filter((url) => url.searchParams.get("maxResults") === "3")
      .map((url) => url.searchParams.get("q")?.match(/after:(\d+)/)?.[1]);
    expect(quarterlyAfterValues).toHaveLength(30);
    expect(quarterlyAfterValues.every((after) => detailIds.has(`m-3-${after}-0`))).toBe(true);

    expect(detailUrls.every((url) => url.searchParams.get("format") === "metadata")).toBe(true);
    expect(detailUrls.every((url) =>
      url.searchParams.get("fields") === "id,threadId,internalDate,labelIds,payload(headers)",
    )).toBe(true);
    expect(detailUrls.every((url) =>
      ["List-Id", "Precedence", "Auto-Submitted", "X-Auto-Response-Suppress"].every((name) =>
        url.searchParams.getAll("metadataHeaders").includes(name),
      ),
    )).toBe(true);
    expect(JSON.stringify(result.stats)).not.toContain("example.test");
    expect(JSON.stringify(result.stats)).not.toContain("subject");
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
