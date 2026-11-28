import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "http://localhost:3001" }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/gmail/personal-connection", () => ({
  personalGmailSessionContext: async () => ({ profileBinding: "fictional-profile", session: { id: "fictional-session" } }),
  freshPersonalGmailAccess: async () => "fixture-gmail-access",
}));

import { preparePersonGmailReview, importPersonGmailReview } from "./actions";
import { createManualRelationshipRecord } from "@/lib/relationship-record";
import { getRelationship, saveRelationship } from "@/lib/relationship-store";
import { relationshipContactFields, relationshipInteractionHistory } from "@/lib/relationship-overview";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mailbox = "owner@example.test", contact = "alex@example.test";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const fixture = (id: string, day: number, from: string, to: string, sent: boolean, body: string) => ({
  id, threadId: "fixture-thread", internalDate: String(Date.UTC(2025, 9, day, 18)), sizeEstimate: 900,
  labelIds: [sent ? "SENT" : "INBOX"],
  payload: { headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: "Catch up" }] },
  body,
});
const fixtures = [
  fixture("older", 3, contact, mailbox, false, "I live in Fictional City. I work at Former Software."),
  fixture("overlap", 15, contact, mailbox, false, "Already reported manually."),
  fixture("later", 20, mailbox, contact, true, "I enjoyed hearing that you started guitar.\n\nOn Friday, Alex wrote:\n> Old private quoted text."),
  fixture("unrelated", 21, "other@example.test", mailbox, false, "Unrelated content."),
];

describe("fictional end-to-end Gmail review and memory import", () => {
  let revision: number;
  let stored: Record<string, unknown> | null;
  let fullReads: string[];
  let modelInputs: string[];

  beforeEach(() => {
    revision = -1; stored = null; fullReads = []; modelInputs = [];
    vi.stubEnv("RA_STORAGE_BACKEND", "supabase");
    vi.stubEnv("RA_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("RA_SUPABASE_SECRET_KEY", "sb_secret_fixture_only");
    vi.stubEnv("RA_DB_OWNER_ID", ownerId);
    vi.stubEnv("RA_PERSONAL_GMAIL_MODEL_APPROVED", "yes");
    vi.stubEnv("OPENAI_API_KEY", "fixture-model-key");
    vi.stubEnv("OPENAI_RELATIONSHIP_MODEL", "fixture-model");
    vi.stubEnv("RELATIONSHIP_USER_TIME_ZONE", "America/Denver");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "example.supabase.co") {
        const data = JSON.parse(String(options?.body));
        if (url.pathname.endsWith("/ra_store_read")) return json(revision === -1 ? null : { revision, document: stored });
        if (url.pathname.endsWith("/ra_store_write")) {
          if (data.p_expected_revision !== revision) return json({ code: "40001" }, 409);
          stored = structuredClone(data.p_document);
          revision++;
          return json(revision);
        }
      }
      if (url.hostname === "gmail.googleapis.com") {
        if (url.pathname.endsWith("/profile")) return json({ emailAddress: mailbox });
        if (url.pathname.endsWith("/messages")) {
          expect(url.searchParams.get("q")).toContain("from:" + contact);
          return json({ messages: fixtures.map(({ id, threadId }) => ({ id, threadId })) });
        }
        const item = fixtures.find((row) => url.pathname.endsWith("/messages/" + row.id));
        if (item) {
          const { body, ...metadata } = item;
          if (url.searchParams.get("format") === "metadata") return json(metadata);
          if (url.searchParams.get("format") === "full") {
            fullReads.push(item.id);
            return json({ ...metadata, payload: { ...metadata.payload, mimeType: "text/plain",
              body: { data: Buffer.from(body).toString("base64url") } } });
          }
        }
      }
      if (url.hostname === "api.openai.com" && url.pathname === "/v1/responses") {
        const request = JSON.parse(String(options?.body));
        expect(request.store).toBe(false);
        const input = JSON.parse(request.input);
        modelInputs.push(input.untrustedMessageBody);
        const observations = input.direction === "received" ? [
          { category: "Location", label: "Home location", value: "Fictional City", evidence: "I live in Fictional City." },
          { category: "Work", label: "Company", value: "Former Software", evidence: "I work at Former Software." },
        ] : [{ category: "Interest", label: "Interest", value: "Guitar", evidence: "you started guitar" }];
        return json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ observations }) }] }] });
      }
      throw new Error("Unexpected fixture endpoint");
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("reviews headers, imports only approved new messages, preserves manual facts and skips replay", async () => {
    const person = createManualRelationshipRecord("Fictional Alex", "Former colleague", undefined, new Date("2025-10-01T12:00:00Z"));
    person.lastInteractionAt = "2025-10-15";
    person.sources.push({ id: "pasted:fixture", source: "transcript", observedAt: "2025-10-15", label: "Manually pasted meeting or call" });
    person.durableFacts.push({ id: "manual-company", category: "Work", label: "Company", value: "Current Software",
      sourceIds: ["pasted:fixture"], firstObservedAt: "2025-10-15", lastObservedAt: "2025-10-15" });
    await saveRelationship(person);
    const plan = await preparePersonGmailReview(person.id, [contact], true);
    expect(plan.kind).toBe("review");
    if (plan.kind !== "review") throw new Error("Expected review");
    expect(plan.review.messages).toEqual([{ day: "2025-10-03", direction: "received" }, { day: "2025-10-20", direction: "sent" }]);
    expect(plan.review.reviewNeeded).toBe(1);
    expect(plan.review.excluded).toBe(1);
    expect(fullReads).toEqual([]);
    expect(modelInputs).toEqual([]);
    const receipt = await importPersonGmailReview(person.id, plan.review.token, true, true);
    expect(receipt).toMatchObject({ kind: "complete", saved: 2, deferredFacts: 1, unconfirmed: 0 });
    expect(fullReads).toEqual(["older", "later"]);
    expect(modelInputs).toEqual([fixtures[0].body, "I enjoyed hearing that you started guitar."]);
    const updated = (await getRelationship(person.id))!;
    expect(updated.lastInteractionAt).toBe("2025-10-20");
    expect(updated.sources.filter((source) => source.gmailImport)).toHaveLength(2);
    expect(updated.durableFacts.some((fact) => fact.value === "Guitar")).toBe(true);
    expect(relationshipContactFields(updated, "2026-11-28").find((field) => field.label === "Company")?.primary?.value).toBe("Current Software");
    expect(relationshipContactFields(updated, "2026-11-28").find((field) => field.label === "Location")?.primary?.value).toBe("Fictional City");
    expect(relationshipInteractionHistory(updated, [], [], "2026-11-28")).toHaveLength(3);
    expect(JSON.stringify(stored)).not.toContain("Old private quoted text");
    expect(JSON.stringify(stored)).not.toContain("I live in Fictional City.");
    expect((await importPersonGmailReview(person.id, plan.review.token, true, true)).kind).toBe("error");
    expect(await preparePersonGmailReview(person.id, [contact], true)).toMatchObject({ kind: "empty", previouslyImported: 2, reviewNeeded: 1 });
    expect(modelInputs).toHaveLength(2);
    expect(fullReads).toHaveLength(2);
  });
});
