import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord, type InteractionExtraction, type RelationshipRecord } from "../relationship-record";
import { relationshipContactFields, relationshipInteractionHistory } from "../relationship-overview";
import { relationshipConnectionStats } from "../relationship-connection-stats";
import { applyPersonImportMemory, type PersonImportMemoryInput } from "./person-import-memory";

const now = new Date("2026-11-28T18:00:00Z");
const mailboxAddress = "owner@example.test";
const contactAddress = "alex@example.test";
function person() {
  return createManualRelationshipRecord("Fictional Alex", "Former colleague", undefined, now);
}
function fact(label: string, value: string, category: InteractionExtraction["durableFacts"][number]["category"] = "Work", existingFactId = "") {
  return { label, value, category, existingFactId };
}
function input(record: RelationshipRecord, id: string, instant: string,
  durableFacts: InteractionExtraction["durableFacts"] = []): PersonImportMemoryInput {
  return { scope: { personId: record.id, mailboxAddress, confirmedAddresses: [contactAddress] },
    candidate: { providerKey: "gmail:" + mailboxAddress + ":" + id, messageId: id,
      threadId: "thread-fixture", observedAt: instant, direction: "received", contactAddress },
    extraction: { durableFacts } };
}
function saved(result: ReturnType<typeof applyPersonImportMemory>) {
  if (result.kind !== "saved") throw new Error("Expected saved");
  return result.record;
}
function apply(record: RelationshipRecord, evidence: PersonImportMemoryInput, others: RelationshipRecord[] = []) {
  return applyPersonImportMemory([record, ...others], [], [], evidence, now, "America/Denver");
}

describe("additive person-specific Gmail memory", () => {
  it("saves precise provider provenance, local contact day, address and new observations; ignores inferred tasks", () => {
    const record = person();
    const evidence = input(record, "m1", "2026-11-20T02:30:00.000Z", [
      fact("Company", "Example Software"), fact("City", "Fictional City", "Location"),
      fact("Email", "unconfirmed@example.test", "Personal"),
    ]);
    evidence.extraction = { ...evidence.extraction, ...({ openLoops: [{ commitment: "Never save this" }] } as object) };
    const updated = saved(apply(record, evidence));
    expect(updated.lastInteractionAt).toBe("2026-11-19");
    const source = updated.sources.at(-1)!;
    expect(source.gmailImport).toMatchObject({
      providerKey: evidence.candidate.providerKey, observedInstant: evidence.candidate.observedAt,
      importedAt: now.toISOString(), threadId: "thread-fixture", direction: "received",
      contactAddress, deferredFacts: [],
    });
    expect(source.observedAt).toBe("2026-11-19");
    expect(updated.durableFacts.map((item) => item.value)).toEqual([
      contactAddress, "Example Software", "Fictional City",
    ]);
    expect(updated.openLoops).toEqual(record.openLoops);
    expect(updated.activeThreads).toEqual(record.activeThreads);
    expect(relationshipContactFields(updated, "2026-11-28").find((item) => item.label === "Location")?.primary?.value)
      .toBe("Fictional City");
    const history = relationshipInteractionHistory(updated, [], [], "2026-11-28");
    expect(history).toMatchObject([{ date: "2026-11-19", countsAsContact: true, label: "Received email · Gmail" }]);
    expect(relationshipConnectionStats(updated, history, "2026-11-28").recordedDays).toBe(1);
    expect(record.durableFacts).toEqual([]);
  });

  it("never overwrites prior manual facts, current promises or a later contact date", () => {
    const record = person();
    record.lastInteractionAt = "2026-11-25";
    record.durableFacts.push({ id: "current-company", category: "Work", label: "Employer",
      value: "Current Software", firstObservedAt: "2026-11-25", lastObservedAt: "2026-11-25",
      sourceIds: [record.sources[0].id] });
    record.openLoops.push({ commitment: "Review the product", owner: "Owner", status: "Open",
      sourceIds: [record.sources[0].id], userConfirmed: true });
    const evidence = input(record, "old", "2025-11-20T15:00:00.000Z",
      [fact("Company", "Former Software", "Work", "current-company")]);
    const updated = saved(apply(record, evidence));
    expect(updated.lastInteractionAt).toBe(record.lastInteractionAt);
    expect(updated.durableFacts.find((item) => item.id === "current-company")).toEqual(record.durableFacts[0]);
    expect(updated.openLoops).toEqual(record.openLoops);
    expect(updated.sources.at(-1)?.gmailImport?.deferredFacts).toEqual([
      { category: "Work", label: "Company", value: "Former Software" },
    ]);
    expect(relationshipContactFields(updated, "2026-11-28").find((item) => item.label === "Company")?.primary?.value)
      .toBe("Current Software");
  });

  it("retains distinct provider-only contact values and adds older exact evidence without moving the current day backward", () => {
    const record = person();
    let updated = saved(apply(record, input(record, "new", "2026-10-20T15:00:00.000Z",
      [fact("Company", "Current Software")])));
    updated = saved(apply(updated, input(updated, "old", "2025-11-20T15:00:00.000Z",
      [fact("Employer", "Former Software")])));
    updated = saved(apply(updated, input(updated, "same", "2026-01-01T15:00:00.000Z",
      [fact("Company", "Current Software")])));
    const field = relationshipContactFields(updated, "2026-11-28").find((item) => item.label === "Company")!;
    expect(field.primary?.value).toBe("Current Software");
    expect(field.values.map((item) => item.value)).toEqual(["Current Software", "Former Software"]);
    expect(updated.durableFacts.find((item) => item.value === "Current Software")).toMatchObject({
      firstObservedAt: "2026-01-01", lastObservedAt: "2026-10-20",
    });
    expect(updated.lastInteractionAt).toBe("2026-10-20");
  });

  it("skips the same exact message on replay and detects an existing provider key on another person", () => {
    const record = person();
    const evidence = input(record, "same", "2026-11-20T15:00:00.000Z");
    const updated = saved(apply(record, evidence));
    expect(apply(updated, evidence)).toEqual({ kind: "duplicate", relationshipId: updated.id });
    const another = person();
    expect(apply(another, input(another, "same", evidence.candidate.observedAt), [updated]))
      .toMatchObject({ kind: "needs-review", reason: "provider-conflict" });
    expect(apply(updated, { ...evidence, candidate: { ...evidence.candidate, threadId: "changed" } }))
      .toMatchObject({ kind: "needs-review", reason: "provider-conflict" });
  });

  it("defers possibly overlapping manual interactions without pretending they are the same email", () => {
    const record = person();
    record.sources.push({ id: "pasted:fixture", source: "transcript", observedAt: "2026-11-20", label: "Manually pasted sent email" });
    const evidence = input(record, "overlap", "2026-11-20T15:00:00.000Z");
    expect(apply(record, evidence)).toEqual({ kind: "needs-review", relationshipId: record.id, reason: "possible-manual-overlap" });
    expect(record.sources).toHaveLength(2);
    expect(record.durableFacts).toEqual([]);
  });

  it("refuses another person's known email, future dates and malformed structured observations", () => {
    const record = person();
    const other = person();
    other.identities.push({ id: "fixture", kind: "email", value: contactAddress, source: "capture",
      label: "Existing address", confirmed: true, sourceIds: [] });
    const evidence = input(record, "m1", "2026-11-20T15:00:00.000Z");
    expect(apply(record, evidence, [other])).toMatchObject({ kind: "needs-review", reason: "identity-conflict" });
    expect(() => apply(record, input(record, "future", "2026-12-01T15:00:00.000Z"))).toThrow("Invalid dated");
    expect(() => apply(record, input(record, "bad", "2026-11-20T15:00:00.000Z",
      [fact("Company", "raw\nbody")]))).toThrow("Invalid structured");
  });

  it("keeps different messages on the same day but counts one recorded contact day", () => {
    const record = person();
    let updated = saved(apply(record, input(record, "m1", "2026-11-20T15:00:00.000Z")));
    updated = saved(apply(updated, input(updated, "m2", "2026-11-20T16:00:00.000Z")));
    const history = relationshipInteractionHistory(updated, [], [], "2026-11-28");
    expect(history).toHaveLength(2);
    expect(relationshipConnectionStats(updated, history, "2026-11-28").recordedDays).toBe(1);
  });
});
