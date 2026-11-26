import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualRelationshipRecord, type InteractionExtraction } from "./relationship-record";
import {
  getRelationship, getCapture, listPersonalMoments, saveRelationship,
  saveNewCapture, savePersonalMoment, saveInferredConversation,
} from "./relationship-store";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const noteRequest = "11111111-1111-4111-8111-111111111111";
const momentRequest = "22222222-2222-4222-8222-222222222222";
const pasteRequest = "33333333-3333-4333-8333-333333333333";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("one-step Home persistence and retry safety", () => {
  let document: Record<string, unknown> | null;
  let revision: number;

  beforeEach(() => {
    document = null;
    revision = -1;
    vi.stubEnv("RA_STORAGE_BACKEND", "supabase");
    vi.stubEnv("RA_SUPABASE_URL", "https://fictional.supabase.co");
    vi.stubEnv("RA_SUPABASE_SECRET_KEY", "sb_secret_fixture_only");
    vi.stubEnv("RA_DB_OWNER_ID", owner);
    vi.stubGlobal("fetch", vi.fn(async (url: string, input: RequestInit) => {
      const payload = JSON.parse(String(input.body));
      if (url.endsWith("/ra_store_read")) return reply(revision < 0 ? null : { revision, document });
      if (url.endsWith("/ra_store_write")) {
        if (payload.p_expected_revision !== revision) return reply({ code: "40001" }, 409);
        document = structuredClone(payload.p_document);
        revision++;
        return reply(revision);
      }
      return reply({ code: "not_found" }, 404);
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("a dated authored note saves once, preserves original day and remains idempotent after retry", async () => {
    const judy = createManualRelationshipRecord("Fictional Judy");
    await saveRelationship(judy);
    const note = "I spoke with Fictional Judy yesterday. She might run a December 5K.";
    const first = await saveNewCapture(note, judy.id, {
      requestId: noteRequest, reportedInteractionAt: "2026-11-24",
    });
    const priorRevision = revision;
    const second = await saveNewCapture(note, judy.id, {
      requestId: noteRequest, reportedInteractionAt: "2026-11-24",
    });
    expect(second.id).toBe(first.id);
    expect(second.reportedInteractionAt).toBe("2026-11-24");
    expect(revision).toBe(priorRevision + 1); // the current adapter writes a no-op replay
    const person = await getRelationship(judy.id);
    expect(person?.lastInteractionAt).toBe("2026-11-24");
    expect(person?.sources.filter((source) => source.id === "capture:" + first.id)).toHaveLength(1);
    expect((await getCapture(first.id))?.capturedAt).toBe(first.capturedAt);
    await expect(saveNewCapture("Different text", judy.id, { requestId: noteRequest,
      reportedInteractionAt: "2026-11-24",
    })).rejects.toThrow("different text");
    expect((await getRelationship(judy.id))?.sources).toHaveLength(person!.sources.length);
  });

  it("moment retries reuse the original private record; key collisions fail closed", async () => {
    const input = { description: "My fictional reflection about training.", consideration: "private" as const,
      requestId: momentRequest };
    const first = await savePersonalMoment(input);
    const second = await savePersonalMoment(input);
    expect(second.id).toBe(first.id);
    expect(await listPersonalMoments()).toHaveLength(1);
    await expect(savePersonalMoment({ ...input, description: "Unrelated content." }))
      .rejects.toThrow("different text");
    await expect(saveNewCapture("A note", null, { requestId: momentRequest }))
      .rejects.toThrow("different material");
  });

  it("a pasted transcript can be merged once without ever retaining its raw text", async () => {
    const judy = createManualRelationshipRecord("Fictional Judy");
    await saveRelationship(judy);
    const extracted: InteractionExtraction = {
      summary: "Fictional Judy is thinking about a 5K.",
      relationshipContexts: [], relationshipRoles: [], tags: [],
      durableFacts: [{ existingFactId: "", category: "Interest",
        label: "Running", value: "Considering a first 5K." }],
      activeThreads: [], openLoops: [], stewardshipOpportunities: [], unknowns: [],
    };
    const source = { id: "pasted:" + pasteRequest, source: "manual" as const,
      observedAt: "2026-11-24", label: "Pasted meeting", submissionDigest: "fixture-digest-1" };
    const first = await saveInferredConversation(judy.id, extracted, source, pasteRequest);
    const second = await saveInferredConversation(judy.id, extracted, source, pasteRequest);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const updated = await getRelationship(judy.id);
    expect(updated?.lastInteractionAt).toBe("2026-11-24");
    expect(updated?.durableFacts).toHaveLength(1);
    expect(updated?.sources.filter((item) => item.id === source.id)).toHaveLength(1);
    expect(JSON.stringify(updated)).not.toContain("Judy: ");
    await expect(saveInferredConversation(judy.id, extracted, {
      ...source, submissionDigest: "different-contents",
    }, pasteRequest)).rejects.toThrow("different text");
  });
});
