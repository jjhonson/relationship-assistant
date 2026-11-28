import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupPersonImportPlan,
  PERSON_IMPORT_MESSAGE_LIMIT,
  planPersonImport,
  type PersonImportScope,
} from "./person-import";
import { PERSON_IMPORT_METADATA_LIMIT, type PilotMetadataMessage } from "./pilot-metadata";

afterEach(() => vi.unstubAllGlobals());

const scope: PersonImportScope = {
  personId: "person-fixture",
  mailboxAddress: "owner@example.test",
  confirmedAddresses: ["alex@example.test", "alex@old.example.test"],
};
const owner = "Owner <owner@example.test>";
const alex = '"Alex, Example" <alex@example.test>';

function message(
  id: string,
  from = alex,
  to = owner,
  time = "2026-11-02T23:12:00Z",
  labels: string[] = ["INBOX"],
  extra: { name: string; value: string }[] = [],
): PilotMetadataMessage {
  return {
    id, threadId: "thread-fixture", internalDate: String(Date.parse(time)), labelIds: labels,
    payload: { headers: [{ name: "From", value: from }, { name: "To", value: to },
      { name: "Subject", value: "Catch up" }, ...extra] },
  };
}

describe("person-scoped Gmail import planning", () => {
  it("preserves independent message identities, precise dates and direction, oldest first", () => {
    const messages = [
      message("reply", alex, owner, "2026-11-04T01:00:00Z"),
      message("sent", owner, "alex@old.example.test", "2026-11-01T23:30:00Z", ["SENT"]),
      message("received"),
      message("received"),
    ];
    const plan = planPersonImport(scope, { messages, truncated: false });
    expect(plan.coverage).toBe("bounded-direct-only");
    expect(plan.candidates.map(({ messageId, direction, observedAt }) =>
      [messageId, direction, observedAt])).toEqual([
      ["sent", "sent", "2026-11-01T23:30:00.000Z"],
      ["received", "received", "2026-11-02T23:12:00.000Z"],
      ["reply", "received", "2026-11-04T01:00:00.000Z"],
    ]);
    expect(plan.candidates[0].contactAddress).toBe("alex@old.example.test");
    expect(plan.candidates[1].providerKey).toBe("gmail:owner@example.test:received");
    expect(plan.candidates[0].threadId).toBe("thread-fixture");
  });

  it("excludes other people, group/ambiguous headers, drafts, automated and calendar messages", () => {
    const messages = [
      message("other", "other@example.test"),
      message("third-party", alex, "other@example.test"),
      message("group", alex, owner + ", other@example.test"),
      message("malformed", alex, owner + ", undisclosed-recipients:;"),
      message("cc", alex, owner, undefined, ["INBOX"], [{ name: "Cc", value: "other@example.test" }]),
      message("bcc", owner, alex, undefined, ["SENT"], [{ name: "Bcc", value: "other@example.test" }]),
      message("two-from", alex, owner, undefined, ["INBOX"], [{ name: "From", value: "other@example.test" }]),
      message("draft", owner, alex, undefined, ["DRAFT", "SENT"]),
      message("trash", alex, owner, undefined, ["TRASH"]),
      message("spam", alex, owner, undefined, ["SPAM"]),
      message("no-sent-label", owner, alex),
      message("automated", alex, owner, undefined, ["INBOX"], [{ name: "Auto-Submitted", value: "auto-replied" }]),
      message("calendar", alex, owner, undefined, ["INBOX"], [{ name: "Subject", value: "Invitation: Catch up" }]),
      message("ics", alex, owner, undefined, ["INBOX"], [{ name: "Content-Type", value: "text/calendar" }]),
      { ...message("unknown-date"), internalDate: undefined },
      { ...message("missing-thread"), threadId: undefined },
      message("ambiguous"), message("ambiguous", "other@example.test"),
      message("good"),
    ];
    const plan = planPersonImport(scope, { messages, truncated: false });
    expect(plan.candidates.map((item) => item.messageId)).toEqual(["good"]);
    expect(plan.excludedCount).toBe(17);
  });

  it("skips already imported account-specific message keys, not other mailboxes' keys", () => {
    const messages = [message("same"), message("new")];
    const plan = planPersonImport(scope, { messages, truncated: true }, [
      "gmail:owner@example.test:same", "gmail:another@example.test:new",
    ]);
    expect(plan.previouslyImportedCount).toBe(1);
    expect(plan.moreAvailable).toBe(true);
    expect(plan.candidates.map((item) => item.messageId)).toEqual(["new"]);
  });

  it("bounds the newest unimported messages and honestly identifies limited coverage", () => {
    const messages = Array.from({ length: PERSON_IMPORT_METADATA_LIMIT }, (_, i) =>
      ({ ...message("m" + i), internalDate: String(Date.parse("2026-10-01") + i * 86_400_000) }));
    const plan = planPersonImport(scope, { messages, truncated: false });
    expect(plan.candidates).toHaveLength(PERSON_IMPORT_MESSAGE_LIMIT);
    expect(plan.candidates[0].messageId).toBe("m20");
    expect(plan.candidates.at(-1)?.messageId).toBe("m39");
    expect(plan.moreAvailable).toBe(true);
    expect(() => planPersonImport(scope, { messages: [...messages, message("extra")], truncated: false }))
      .toThrow("bounded import limit");
  });

  it("fails closed for empty or self identities and unsafe query values before any provider request", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const confirmedAddresses of [[], ["owner@example.test"], ["x@example.test} OR in:anywhere"]]) {
      await expect(lookupPersonImportPlan("fixture-token", { ...scope, confirmedAddresses })).rejects.toThrow("confirmed distinct");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks the actual connected account before requesting only bounded headers", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      let result: unknown;
      if (url.pathname.endsWith("/profile")) result = { emailAddress: scope.mailboxAddress };
      else if (url.pathname.endsWith("/messages")) result = { messages: [{ id: "one", threadId: "thread-fixture" }], nextPageToken: "unread-page" };
      else if (url.pathname.endsWith("/messages/one")) result = message("one");
      else throw new Error("Unexpected endpoint");
      return new Response(JSON.stringify(result));
    }));
    const plan = await lookupPersonImportPlan("fixture-token", scope);
    expect(plan.candidates.map((item) => item.messageId)).toEqual(["one"]);
    expect(plan.moreAvailable).toBe(true);
    expect(urls).toHaveLength(3);
    expect(urls[0].pathname).toMatch(/\/profile$/);
    expect(urls[1].searchParams.get("maxResults")).toBe(String(PERSON_IMPORT_METADATA_LIMIT));
    expect(urls[1].searchParams.get("q")).toBe(
      "{from:alex@example.test to:alex@example.test from:alex@old.example.test to:alex@old.example.test} -in:drafts -in:trash -in:spam",
    );
    expect(urls[2].searchParams.get("format")).toBe("metadata");
    expect(urls[2].searchParams.getAll("metadataHeaders")).toContain("Bcc");
    expect(urls[2].searchParams.get("fields")).toBe("id,threadId,internalDate,labelIds,payload(headers)");
    expect(urls.every((url) => !url.pathname.includes("/threads/") && !url.pathname.includes("/attachments/") &&
      url.searchParams.get("format") !== "full")).toBe(true);
  });

  it("refuses a changed Gmail account without searching its messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ emailAddress: "another@example.test" }))));
    await expect(lookupPersonImportPlan("fixture-token", scope)).rejects.toThrow("does not match");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
