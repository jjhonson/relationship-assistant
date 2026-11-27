import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import { applyCadencePreference, daysSinceContact, dismissCadenceCycle, dueCadence, parseCadencePreference, relationshipCadence } from "./relationship-cadence";

const today = "2026-11-27";
function person() {
  const p = createManualRelationshipRecord("Avery Fixture", undefined, undefined, new Date("2026-05-01T10:00:00Z"));
  p.lastInteractionAt = "2026-05-01";
  p.sources.push({ id: "pasted:fixture", source: "manual", observedAt: "2026-05-01", label: "Saved conversation" });
  p.inferredRelationshipContexts = [{ value: "Former colleague", sourceIds: ["pasted:fixture"],
    verification: "Unverified", lastSuggestedAt: "2026-05-01" }];
  return p;
}
describe("editable cadence working opinion", () => {
  it("uses a cautious former-colleague default without making it a confirmed label", () => {
    const p = person();
    expect(relationshipCadence(p, today)).toMatchObject({ days: 180, userSelected: false });
    expect(p.relationshipContexts).toEqual([]);
    expect(p.contactCadenceDays).toBeUndefined();
    const due = dueCadence(p, today);
    expect(due?.basisId).toBe("cadence:2026-05-01:180");
  });
  it("requires evidence, valid dates and sufficient elapsed time", () => {
    const p = person();
    p.inferredRelationshipContexts![0].sourceIds = ["unknown"];
    expect(relationshipCadence(p, today)).toBeNull();
    p.contactCadenceDays = 180;
    p.lastInteractionAt = "2026-11-23";
    expect(daysSinceContact(p, today)).toBe(4);
    expect(dueCadence(p, today)).toBeNull();
    p.lastInteractionAt = null;
    expect(dueCadence(p, today)).toBeNull();
    p.lastInteractionAt = "2026-11-28";
    expect(dueCadence(p, today)).toBeNull();
  });
  it("preserves explicit choices, including off, and supports returning to suggested", () => {
    const p = person();
    const off = applyCadencePreference(p, parseCadencePreference("0"));
    expect(relationshipCadence(off, today)).toMatchObject({ days: 0, userSelected: true });
    expect(dueCadence(off, today)).toBeNull();
    const reset = applyCadencePreference(off, parseCadencePreference("suggested"));
    expect(relationshipCadence(reset, today)).toMatchObject({ days: 180, userSelected: false });
    expect(reset.lastInteractionAt).toBe(p.lastInteractionAt);
    expect(reset.sources).toEqual(p.sources);
    expect(() => parseCadencePreference("17")).toThrow();
  });
  it("dismisses exactly the current due cycle", () => {
    const p = person();
    const due = dueCadence(p, today)!;
    const dismissed = dismissCadenceCycle(p, due.basisId, today);
    expect(dueCadence(dismissed, today)).toBeNull();
    expect(dismissed.lastInteractionAt).toBe(p.lastInteractionAt);
    expect(() => dismissCadenceCycle(p, "cadence:2026-01-01:180", today)).toThrow();
  });
});
