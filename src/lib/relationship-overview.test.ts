import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import type { DurableRelationshipFact } from "./relationship-record";
import { relationshipContactDetails, relationshipContextLabel, lastContactDescription, relationshipContextSummary, relationshipInteractionHistory } from "./relationship-overview";
import { INTERACTION_INFERENCE_SYSTEM_PROMPT } from "./interaction-inference";

const today = "2026-11-27";
function person() {
  const record = createManualRelationshipRecord("Avery Fixture", undefined, undefined, new Date("2026-11-26T10:00:00Z"));
  record.lastInteractionAt = "2026-11-23";
  record.sources.push({ id: "pasted:fixture", source: "manual", observedAt: "2026-11-23", label: "Manually pasted meeting or call" });
  return record;
}
function fact(id: string, category: DurableRelationshipFact["category"], label: string, value: string, date = "2026-11-23", source = "pasted:fixture"): DurableRelationshipFact {
  return { id, category, label, value, sourceIds: [source], firstObservedAt: date, lastObservedAt: date };
}
describe("relationship overview", () => {
  it("reuses sourced older field labels without changing the record or inventing missing details", () => {
    const p = person();
    p.durableFacts.push(
      fact("home", "Location", "Home", "Lives in Exampletown near the foothills."),
      fact("employer", "Work", "Employer", "Example Software"),
      fact("title", "Work", "Job title", "Engineering Director"),
      fact("birth", "Personal", "Birthday", "March 12"),
      fact("history", "Work", "Former employer", "Previous Company"),
      fact("future", "Location", "Possible relocation", "Another state"),
      fact("unsupported", "Personal", "Email", "unknown@example.com", "2026-11-23", "missing"),
    );
    const prior = JSON.stringify(p);
    const fields = relationshipContactDetails(p, today);
    expect(fields.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "Company", value: "Example Software" },
      { label: "Title", value: "Engineering Director" },
      { label: "Location", value: "Lives in Exampletown near the foothills." },
      { label: "Birthday", value: "March 12" },
    ]);
    expect(JSON.stringify(p)).toBe(prior);
    expect(relationshipContextSummary(p, fields, today).map((item) => item.value)).toEqual(["Previous Company", "Another state"]);
  });

  it("chooses current dated evidence, leaves same-day contradictions unresolved and rejects unsafe links", () => {
    const p = person();
    p.sources.push({ id: "pasted:new", source: "manual", observedAt: today, label: "New meeting" });
    p.durableFacts.push(
      fact("old", "Work", "Company", "Previous Company"),
      fact("new", "Work", "Company", "Current Company", today, "pasted:new"),
      fact("title1", "Work", "Role", "Director"),
      fact("title2", "Work", "Title", "VP"),
      fact("badlink", "Personal", "LinkedIn", "javascript:alert(1)"),
      fact("goodemail", "Personal", "Email", "avery@example.com"),
    );
    const fields = relationshipContactDetails(p, today);
    expect(fields.map((field) => field.value)).toEqual(["Current Company", "avery@example.com"]);
  });

  it("does not claim inferred context is user-confirmed, or a future date is a contact", () => {
    const p = person();
    p.inferredRelationshipContexts = [{ value: "Former colleague", sourceIds: ["pasted:fixture"],
      lastSuggestedAt: "2026-11-23", verification: "Unverified" }];
    expect(relationshipContextLabel(p, today)).toEqual({ value: "Former colleague", inferred: true });
    expect(lastContactDescription(p, today)).toEqual({ date: "Nov 23, 2026", elapsed: "4 days ago" });
    p.lastInteractionAt = "2026-11-28";
    expect(lastContactDescription(p, today).date).toBe("Not recorded");
  });

  it("shows dated saved interactions, not relationship creation or an earlier version of a merged fact", () => {
    const p = person();
    p.sources.push({ id: "pasted:old", source: "manual", observedAt: "2026-04-02", label: "Earlier meeting" });
    p.durableFacts.push({ ...fact("home", "Location", "Home", "New home"), sourceIds: ["pasted:old", "pasted:fixture"] });
    const entries = relationshipInteractionHistory(p, [], [], today);
    expect(entries.map((entry) => [entry.date, entry.detail])).toEqual([
      ["2026-11-23", "Remembered topics: Home"],
      ["2026-04-02", "Saved conversation context"],
    ]);
  });

  it("preserves the typed contact-field extraction contract in the existing capture call", () => {
    expect(INTERACTION_INFERENCE_SYSTEM_PROMPT).toContain("Company (Work), Role (Work");
    expect(INTERACTION_INFERENCE_SYSTEM_PROMPT).toContain("City (Location, current home city/area)");
    expect(INTERACTION_INFERENCE_SYSTEM_PROMPT).toContain("Birthday (Personal)");
    expect(INTERACTION_INFERENCE_SYSTEM_PROMPT).toContain("Do not manufacture missing fields");
  });
});
