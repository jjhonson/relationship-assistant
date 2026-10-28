import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHistoricalMessages, type DiscoveryMessage } from "./messages";
import { rankCandidates } from "./discovery";

afterEach(() => vi.unstubAllGlobals());

function message(
  id: string,
  from: string,
  to: string,
  date: string,
  extraHeaders: { name: string; value: string }[] = [],
  sent = false,
): DiscoveryMessage {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: String(Date.parse(date)),
    labelIds: sent ? ["SENT"] : ["INBOX"],
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Date", value: date },
        ...extraHeaders,
      ],
    },
  };
}

describe("relationship discovery ranking", () => {
  it("prioritizes direct correspondence and excludes mailing lists and automated senders", () => {
    const candidates = rankCandidates([
      message("out", "Owner <owner@example.test>", "Alex Morgan <alex@example.test>", "Mon, 01 Jan 2024 10:00:00 +0000", [], true),
      message("in", "Alex Morgan <alex@example.test>", "Owner <owner@example.test>", "Tue, 02 Jan 2024 10:00:00 +0000"),
      message("newsletter", "Weekly Update <news@example.test>", "Owner <owner@example.test>", "Wed, 03 Jan 2024 10:00:00 +0000", [
        { name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.test>" },
      ]),
      message("automated", "No Reply <no-reply@store.example.test>", "Owner <owner@example.test>", "Thu, 04 Jan 2024 10:00:00 +0000"),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: "Alex Morgan",
      address: "alex@example.test",
      sent: 1,
      received: 1,
      uncertainty: "Repeated correspondence observed",
    });
    expect(candidates[0].reasons.join(" ")).toContain("both sent and received");
  });

  it("keeps a single formal exchange as a possible contact without inferring a relationship", () => {
    const candidates = rankCandidates([
      message(
        "recruiter",
        "Jordan Lee <jordan@careers.example.test>",
        "Owner <owner@example.test>",
        "Fri, 05 Jan 2024 10:00:00 +0000",
      ),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].uncertainty).toBe("Possible");
    expect(candidates[0].received).toBe(1);
    expect(candidates[0].reasons).toEqual([
      "1 message from this address was observed.",
      "They span 1 date and 1 thread.",
    ]);
  });
});

describe("historical metadata sampling", () => {
  it("covers multiple calendar years, follows pagination, and requests metadata headers only", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith("/messages")) {
        const year = Number(url.searchParams.get("q")?.match(/after:(\d{4})/)?.[1]);
        const firstYearPage = year === 2025 && !url.searchParams.has("pageToken");
        const ids = firstYearPage ? ["y2025a"] : year === 2025 ? ["y2025b"] : [`y${year}a`, `y${year}b`];
        const page = {
          messages: ids.map((id) => ({ id, threadId: `t-${id}` })),
          ...(firstYearPage ? { nextPageToken: "next-page" } : {}),
        };
        return new Response(JSON.stringify(page), { status: 200 });
      }
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return new Response(JSON.stringify({
        id,
        threadId: `t-${id}`,
        internalDate: String(Date.parse("2025-01-02T00:00:00Z")),
        labelIds: ["INBOX"],
        payload: { headers: [{ name: "From", value: "Person <person@example.test>" }] },
      }), { status: 200 });
    }));

    const messages = await fetchHistoricalMessages("fake-token", 20, new Date("2025-06-01T00:00:00Z"));
    const listRequests = requests.filter((url) => url.pathname.endsWith("/messages"));
    const details = requests.filter((url) => /\/messages\/[^/]+$/.test(url.pathname));

    expect(messages).toHaveLength(20);
    expect(new Set(listRequests.map((url) => url.searchParams.get("q")?.match(/after:(\d{4})/)?.[1])).size).toBe(10);
    expect(listRequests.some((url) => url.searchParams.get("pageToken") === "next-page")).toBe(true);
    expect(details).toHaveLength(20);
    expect(details[0].searchParams.get("format")).toBe("metadata");
    expect(details[0].searchParams.getAll("metadataHeaders")).toEqual([
      "From",
      "To",
      "Cc",
      "Date",
      "List-Id",
      "List-Unsubscribe",
      "Precedence",
      "Auto-Submitted",
      "X-Auto-Response-Suppress",
    ]);
    expect(details[0].searchParams.get("fields")).not.toContain("body");
  });
});
