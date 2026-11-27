import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import {
  correctSavedActionableMemory, getRelationship, listConnectionJourneys,
  saveRelationshipCadence, dismissSavedConnectionSuggestion,
  listPersonalMoments, saveConfirmedConnectionEvents,
  savePersonalMoment, saveRelationship, startConnectionJourney,
} from "./relationship-store";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("fictional Next.js domain operations with remote storage selected", () => {
  let revision: number;
  let stored: Record<string, unknown> | null;
  let calls: string[];

  beforeEach(() => {
    revision = -1;
    stored = null;
    calls = [];
    vi.stubEnv("RA_STORAGE_BACKEND", "supabase");
    vi.stubEnv("RA_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("RA_SUPABASE_SECRET_KEY", "sb_secret_synthetic_fixture");
    vi.stubEnv("RA_DB_OWNER_ID", owner);
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const data = JSON.parse(String(options.body)) as Record<string, unknown>;
      calls.push(url);
      if (url.endsWith("/ra_store_read")) {
        return json(revision === -1 ? null : { revision, document: stored });
      }
      if (url.endsWith("/ra_store_write")) {
        if (data.p_expected_revision !== revision) return json({ code: "40001" }, 409);
        stored = structuredClone(data.p_document) as Record<string, unknown>;
        revision++;
        return json(revision);
      }
      return json({ code: "unexpected" }, 404);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("preserves fictional people, moments, source corrections and two-event learning", async () => {
    const judy = createManualRelationshipRecord("Fictional Judy");
    const sourceId = "fictional-note:running";
    judy.sources.push({ id: sourceId, source: "manual", observedAt: "2026-11-20", label: "Fictional conversation" });
    judy.openLoops.push({
      owner: "Jason", status: "Open", commitment: "Send Judy a fictional race link.",
      sourceIds: [sourceId],
    });
    await saveRelationship(judy);
    expect((await getRelationship(judy.id))?.personLabel).toBe("Fictional Judy");

    const moment = await savePersonalMoment({ description: "A fictional article about training", consideration: "private" });
    expect((await listPersonalMoments())[0].id).toBe(moment.id);

    await correctSavedActionableMemory(judy.id, {
      kind: "open-loop", owner: "Jason", commitment: "Send Judy a fictional race link.",
    }, "Done");
    expect((await getRelationship(judy.id))?.actionableMemoryFeedback?.[0].disposition).toBe("Done");

    const journey = await startConnectionJourney(judy.id, "A fictional running article", "", "Jason");
    const events = await saveConfirmedConnectionEvents(judy.id, journey.id, [
      { kind: "sent", happenedOn: "2026-11-22", summary: "I sent a fictional running article.", outcome: "" },
      { kind: "reply_received", happenedOn: "2026-11-23",
        summary: "Judy replied about running.",
        outcome: "She is considering a local 5K but has not registered." },
    ], "2026-11-25", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(events.events).toHaveLength(2);
    expect((await listConnectionJourneys(judy.id))[0].events).toHaveLength(2);
    const learned = (await getRelationship(judy.id))!;
    expect(learned.durableFacts.some(f => f.value.includes("has not registered"))).toBe(true);
    expect(learned.sources.some(s => s.id === sourceId)).toBe(true);
    expect(stored?.relationships).toBeDefined();
    expect(stored?.moments).toBeDefined();
    expect(stored?.connectionJourneys).toBeDefined();
    expect(revision).toBeGreaterThan(3);
    expect(calls.every(url => url.includes("example.supabase.co/rest/v1/rpc/ra_store_"))).toBe(true);
  });
  it("persists an optional cadence and exact-cycle dismissal without modifying existing memory or dates", async () => {
    const p = createManualRelationshipRecord("Fictional Avery");
    p.lastInteractionAt = "2025-01-01";
    p.durableFacts.push({ id: "example", category: "Work", label: "Company", value: "Example Software",
      sourceIds: [p.sources[0].id], firstObservedAt: "2025-01-01", lastObservedAt: "2025-01-01" });
    await saveRelationship(p);
    await saveRelationshipCadence(p.id, 180);
    const chosen = (await getRelationship(p.id))!;
    expect(chosen.contactCadenceDays).toBe(180);
    expect(chosen.lastInteractionAt).toBe(p.lastInteractionAt);
    expect(chosen.durableFacts).toEqual(p.durableFacts);
    expect(chosen.sources).toEqual(p.sources);
    await expect(dismissSavedConnectionSuggestion(p.id, "cadence:2025-01-02:180", "Jason")).rejects.toThrow("no longer current");
    await dismissSavedConnectionSuggestion(p.id, "cadence:2025-01-01:180", "Jason");
    expect((await getRelationship(p.id))?.dismissedCadenceCycle).toBe("cadence:2025-01-01:180");
    await saveRelationshipCadence(p.id, 0);
    expect((await getRelationship(p.id))?.contactCadenceDays).toBe(0);
    await saveRelationshipCadence(p.id, undefined);
    expect((await getRelationship(p.id))?.contactCadenceDays).toBeUndefined();
    expect((await getRelationship(p.id))?.durableFacts).toEqual(p.durableFacts);
  });

});
