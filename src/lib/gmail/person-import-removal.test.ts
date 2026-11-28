import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord, type RelationshipRecord } from "../relationship-record";
import { applyPersonImportMemory, type PersonImportMemoryInput } from "./person-import-memory";
import { planGmailMemoryRemoval, reviewPersonGmailMemory } from "./person-import-removal";
import { relationshipInteractionHistory } from "../relationship-overview";
import type { ConnectionJourney } from "../connection-journey";

const now = new Date("2026-11-28T18:00:00Z");
function fixture() {
  const record = createManualRelationshipRecord("Fictional Alex", "Former colleague", undefined, new Date("2026-10-01T18:00:00Z"));
  record.lastInteractionAt = "2026-10-01";
  record.sources.push({ id: "pasted:fixture", source: "transcript", observedAt: "2026-10-01", label: "Manual meeting" });
  record.durableFacts.push({ id: "manual", category: "Work", label: "Company", value: "Example Software",
    sourceIds: ["pasted:fixture"], firstObservedAt: "2026-10-01", lastObservedAt: "2026-10-01" });
  record.openLoops.push({ owner: "Owner", commitment: "Send a book", status: "Open", sourceIds: ["pasted:fixture"], userConfirmed: true });
  return record;
}
function evidence(record: RelationshipRecord, id: string, day: number, mailboxAddress = "owner@example.test"): PersonImportMemoryInput {
  const contactAddress = "alex@example.test";
  return {
    scope: { personId: record.id, mailboxAddress, confirmedAddresses: [contactAddress],
      ...(record.gmailMemoryRevision === undefined ? {} : { memoryRevision: record.gmailMemoryRevision }) },
    candidate: { providerKey: "gmail:" + mailboxAddress + ":" + id, messageId: id, threadId: "thread", observedAt: new Date(Date.UTC(2026, 10, day, 18)).toISOString(), direction: "received", contactAddress },
    extraction: { durableFacts: [
      { existingFactId: "", category: "Work", label: "Company", value: "Example Software" },
      { existingFactId: "", category: "Interest", label: "Interest", value: "Guitar" },
      { existingFactId: "", category: "Work", label: "Company", value: "Different Software" },
    ] },
  };
}
function learn(record: RelationshipRecord, input: PersonImportMemoryInput) {
  const result = applyPersonImportMemory([record], [], [], input, now, "America/Denver");
  if (result.kind !== "saved") throw new Error("Expected saved");
  return result.record;
}

describe("explicit source-aware Gmail memory removal", () => {
  it("removes only selected source evidence and restores independent contact and fact dates", () => {
    const original = fixture();
    const first = learn(original, evidence(original, "first", 10));
    const second = learn(first, evidence(first, "second", 20, "second-owner@example.test"));
    const review = reviewPersonGmailMemory(second);
    expect(review.sources.map((item) => item.mailbox)).toEqual(["second-owner@example.test", "owner@example.test"]);
    expect(review.sources[0].deferredFacts).toEqual([{ label: "Company", value: "Different Software" }]);
    expect(review.sources[0].facts.find((fact) => fact.label === "Company")?.otherEvidence).toBe(true);
    const removed = planGmailMemoryRemoval(second, [], [], [review.sources[0].id], review.version, now, "America/Denver");
    expect(removed.removedMessages).toBe(1);
    expect(removed.record.lastInteractionAt).toBe("2026-11-10");
    expect(removed.record.durableFacts.find((fact) => fact.id === "manual")?.lastObservedAt).toBe("2026-11-10");
    expect(removed.record.openLoops).toEqual(original.openLoops);
    expect(removed.record.sources.some((source) => source.gmailImport?.mailboxAddress === "second-owner@example.test")).toBe(false);
    const remaining = reviewPersonGmailMemory(removed.record);
    const all = planGmailMemoryRemoval(removed.record, [], [], [remaining.sources[0].id], remaining.version, now, "America/Denver");
    expect(all.record.durableFacts).toEqual(original.durableFacts);
    expect(all.record.sources).toEqual(original.sources);
    expect(all.record.lastInteractionAt).toBe(original.lastInteractionAt);
    expect(all.record.gmailBaselineContactDay).toBeUndefined();
    expect(all.record.openLoops).toEqual(original.openLoops);
    expect(relationshipInteractionHistory(all.record, [], [], "2026-11-28")).toHaveLength(1);
    expect(second.sources.filter((source) => source.gmailImport)).toHaveLength(2);
  });

  it("rejects stale reviews and attempts to remove manual or unrelated sources", () => {
    const original = fixture();
    const updated = learn(original, evidence(original, "first", 10));
    const review = reviewPersonGmailMemory(updated);
    expect(() => planGmailMemoryRemoval(updated, [], [], ["pasted:fixture"], review.version, now)).toThrow("Select saved");
    expect(() => planGmailMemoryRemoval(updated, [], [], ["gmail-import:" + "a".repeat(64)], review.version, now)).toThrow("not an imported");
    expect(() => planGmailMemoryRemoval({ ...updated, personLabel: "Changed" }, [], [], [review.sources[0].id], review.version, now)).toThrow("changed");
    expect(updated.sources).toHaveLength(3);
  });

  it("preserves user-confirmed journal events and independent later recency; detaches deleted basis", () => {
    const record = fixture();
    const updated = learn(record, evidence(record, "first", 10));
    const review = reviewPersonGmailMemory(updated);
    const journey: ConnectionJourney = { id: "journey", relationshipId: updated.id, subject: "User-approved guitar conversation",
      basisId: "fact:fixture", basisSourceIds: [review.sources[0].id], startedAt: now.toISOString(),
      events: [{ id: "event", kind: "interaction_occurred", happenedOn: "2026-11-10", recordedAt: now.toISOString(), summary: "User recorded meeting", outcome: "" }] };
    const removed = planGmailMemoryRemoval(updated, [], [journey], [review.sources[0].id], review.version, now, "America/Denver");
    expect(removed.record.lastInteractionAt).toBe("2026-11-10");
    expect(removed.journeys[0]).toEqual({ ...journey, basisId: "", basisSourceIds: [] });
    expect(removed.record.durableFacts).toEqual(record.durableFacts);
  });

  it("invalidates old import scopes after removal; only a new explicitly reviewed scope can restore evidence", () => {
    const original = fixture();
    const old = evidence(original, "first", 10);
    const updated = learn(original, old);
    const review = reviewPersonGmailMemory(updated);
    const removed = planGmailMemoryRemoval(updated, [], [], [review.sources[0].id], review.version, now).record;
    expect(applyPersonImportMemory([removed], [], [], old, now)).toMatchObject({ kind: "needs-review", reason: "memory-removed" });
    const fresh = evidence(removed, "first", 10);
    expect(learn(removed, fresh).sources.filter((source) => source.gmailImport)).toHaveLength(1);
  });

  it("does not silently discard unexpected dependent memory", () => {
    const original = fixture();
    const updated = learn(original, evidence(original, "first", 10));
    const id = reviewPersonGmailMemory(updated).sources[0].id;
    updated.openLoops.push({ owner: "Owner", commitment: "Independent review needed", status: "Open", sourceIds: [id] });
    expect(() => planGmailMemoryRemoval(updated, [], [], [id], reviewPersonGmailMemory(updated).version, now)).toThrow("dependent memory");
  });
});
