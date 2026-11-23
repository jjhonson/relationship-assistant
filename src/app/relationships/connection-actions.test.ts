import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRelationship: vi.fn(), listConnectionJourneys: vi.fn(),
  saveConfirmedConnectionEvents: vi.fn(), startConnectionJourney: vi.fn(),
  interpretMultiEventUpdate: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/relationship-store", () => ({
  getRelationship: mocks.getRelationship,
  listConnectionJourneys: mocks.listConnectionJourneys,
  saveConfirmedConnectionEvents: mocks.saveConfirmedConnectionEvents,
  startConnectionJourney: mocks.startConnectionJourney,
}));
vi.mock("@/lib/connection-multi-event", () => ({
  interpretMultiEventUpdate: mocks.interpretMultiEventUpdate,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  previewMultipleConnectionActivities, confirmMultipleConnectionActivities,
} from "./connection-actions";

const id = "c457bf12-497e-41a2-adbc-2cc8d0dff001";
const input = [
  { kind: "sent" as const, happenedOn: "2026-11-22", summary: "Sent an article.", outcome: "" },
  { kind: "reply_received" as const, happenedOn: "2026-11-23",
    summary: "Tom replied.", outcome: "Tom hopes to play an open mic someday." },
];

describe("multi-event connection actions", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.clearAllMocks();
    mocks.getRelationship.mockResolvedValue({ id: "tom", personLabel: "Fictional Tom" });
    mocks.listConnectionJourneys.mockResolvedValue([
      { id: "journey", relationshipId: "tom", subject: "Guitar article", events: [] },
    ]);
    mocks.interpretMultiEventUpdate.mockResolvedValue({
      events: input.map((event) => ({ ...event, question: "" })), question: "",
    });
    mocks.saveConfirmedConnectionEvents.mockResolvedValue({
      journey: { id: "journey" }, events: [{ id: "one" }, { id: "two" }], duplicate: false,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not save during review and anchors the person without exposing the contact directory", async () => {
    const result = await previewMultipleConnectionActivities("tom", "journey", "I sent a note and he replied.");
    expect(result.events).toHaveLength(2);
    const sent = mocks.interpretMultiEventUpdate.mock.calls[0][0];
    expect(sent).toMatchObject({ person: "Fictional Tom", subject: "Guitar article" });
    expect(mocks.saveConfirmedConnectionEvents).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires an existing saved person and tracked connection", async () => {
    await expect(previewMultipleConnectionActivities("tom", "unrelated", "We met yesterday."))
      .rejects.toThrow(/not found/);
    expect(mocks.interpretMultiEventUpdate).not.toHaveBeenCalled();
  });

  it("confirms both reviewed events in a single atomic store call with an ID", async () => {
    const result = await confirmMultipleConnectionActivities("tom", "journey", input, id);
    expect(result).toEqual({ saved: true, recordedCount: 2, duplicate: false });
    expect(mocks.saveConfirmedConnectionEvents).toHaveBeenCalledOnce();
    expect(mocks.saveConfirmedConnectionEvents.mock.calls[0]).toMatchObject([
      "tom", "journey", input, expect.any(String), id,
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/relationships/tom");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("rejects transcript-shaped summaries before any database write", async () => {
    await expect(confirmMultipleConnectionActivities("tom", "journey", [{
      ...input[1], summary: "Tom: I can play guitar.\nMe: Great.",
    }], id)).rejects.toThrow(/pasted conversations/i);
    expect(mocks.saveConfirmedConnectionEvents).not.toHaveBeenCalled();
  });

  it("doesn't treat empty or oversized batches as valid", async () => {
    await expect(confirmMultipleConnectionActivities("tom", "journey", [], id))
      .rejects.toThrow(/one to five/);
    await expect(confirmMultipleConnectionActivities("tom", "journey",
      Array.from({ length: 6 }, () => input[0]), id)).rejects.toThrow(/one to five/);
    expect(mocks.saveConfirmedConnectionEvents).not.toHaveBeenCalled();
  });
});
