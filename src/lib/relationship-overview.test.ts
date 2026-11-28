import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import type { DurableRelationshipFact } from "./relationship-record";
import { relationshipContactDetails, relationshipContactFields, relationshipPortrait, relationshipContextLabel, lastContactDescription, relationshipContextSummary, relationshipInteractionHistory } from "./relationship-overview";
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
  it("keeps traditional slots, aggregates distinct evidence-backed values, and never declares an old address invalid", () => {
    const p = person();
    p.sources.push(
      { id: "gmail:old", source: "gmail", label: "Older email metadata", observedAt: "2024-02-14" },
      { id: "gmail:new", source: "gmail", label: "Recent email metadata", observedAt: today },
      { id: "capture:given", source: "capture", label: "Address supplied by user", observedAt: "2025-07-08" },
    );
    p.identities = [
      { id: "old", kind: "email", value: "avery@old.example", source: "gmail", confirmed: true, label: "Previously confirmed", sourceIds: ["gmail:old"] },
      { id: "new", kind: "email", value: "avery@new.example", source: "gmail", confirmed: false, label: "Recently seen", sourceIds: ["gmail:new"] },
    ];
    p.durableFacts.push(
      fact("personal", "Personal", "Email", "avery@personal.example", "2025-07-08", "capture:given"),
      fact("repeat", "Personal", "Email", "avery@new.example", today, "gmail:new"),
    );
    const fields = relationshipContactFields(p, today);
    expect(fields.map((f) => f.label)).toEqual(["Company", "Title", "Location", "Email", "Phone", "LinkedIn", "Birthday"]);
    expect(fields.find((f) => f.label === "Phone")?.primary).toBeNull();
    const email = fields.find((f) => f.label === "Email")!;
    expect(email.primary?.value).toBe("avery@new.example");
    expect(email.values.map((v) => v.value)).toEqual(["avery@new.example", "avery@personal.example", "avery@old.example"]);
    expect(email.values[0].observations).toHaveLength(1);
    expect(email.values[2].confirmed).toBe(true);
  });
  it("shows same-day distinct alternatives without silently picking a winner", () => {
    const p = person();
    p.durableFacts.push(fact("one", "Work", "Company", "One"), fact("two", "Work", "Company", "Two"));
    const field = relationshipContactFields(p, today).find((f) => f.label === "Company")!;
    expect(field.primary).toBeNull();
    expect(field.values).toHaveLength(2);
  });
  it("does not attribute a changed value to earlier linked sources", () => {
    const p = person();
    p.sources.push({ id: "pasted:old", source: "manual", observedAt: "2020-03-01", label: "Older conversation" });
    p.durableFacts.push({ ...fact("employer", "Work", "Company", "New employer"), sourceIds: ["pasted:old", "pasted:fixture"] });
    const field = relationshipContactFields(p, today).find((f) => f.label === "Company")!;
    expect(field.primary?.observations.map((s) => [s.id, s.attribution])).toEqual([
      ["pasted:fixture", "value"], ["pasted:old", "earlier-context"],
    ]);
  });
  it("groups meaningful portrait facts, preserves explicit past-state wording and never infers change from age", () => {
    const p = person();
    p.sources.push({ id: "pasted:old", source: "manual", observedAt: "2016-06-01", label: "Earlier conversation" });
    p.durableFacts.push(
      fact("company", "Work", "Company", "Example Company"),
      fact("fish", "Interest", "Former interest", "Used to fish regularly; said they no longer fish."),
      fact("guitar", "Interest", "Guitar", "Enjoys playing guitar.", "2016-06-01", "pasted:old"),
      fact("shared", "Personal", "Shared history", "Played on a football team together.", "2016-06-01", "pasted:old"),
      fact("family", "Family", "Children", "Children are in school."),
      fact("unknown", "Interest", "Hobby", "Unsourced claim", today, "missing"),
    );
    const groups = relationshipPortrait(p, today);
    expect(groups.map((g) => g.label)).toEqual(["Interests & activities", "Family & life", "Shared history", "Earlier chapters"]);
    expect(groups.find((g) => g.label === "Interests & activities")?.items[0].value).toBe("Enjoys playing guitar.");
    expect(groups.find((g) => g.label === "Earlier chapters")?.items[0].value).toContain("no longer fish");
    expect(JSON.stringify(groups)).not.toContain("Example Company");
    expect(JSON.stringify(groups)).not.toContain("Unsourced claim");
  });

  it("keeps earlier residence separate from newer image city, work location and profile geography",()=>{
    const p=person();
    p.sources.push({id:"capture:profile",source:"capture",observedAt:today,label:"Photo you chose (image not retained)"});
    p.durableFacts.push(
      fact("legacy-home","Location","City","Home Town"),
      fact("legacy-image","Location","City","Office Town",today,"capture:profile"),
      fact("work-city","Work","Work location","Office Town",today,"capture:profile"),
      fact("profile-region","Location","Profile location","Metro Area",today,"capture:profile"),
    );
    const before=JSON.stringify(p);
    const home=relationshipContactFields(p,today).find(field=>field.label==="Location");
    expect(home?.primary?.value).toBe("Home Town");
    expect(home?.values.map(item=>item.value)).toEqual(["Home Town"]);
    const groups=relationshipPortrait(p,today);
    expect(groups.find(g=>g.label==="Work & projects")?.items).toEqual(expect.arrayContaining([expect.objectContaining({label:"Work location",value:"Office Town"})]));
    expect(groups.find(g=>g.label==="Places & plans")?.items).toEqual(expect.arrayContaining([expect.objectContaining({label:"Location (meaning unclear)",value:"Office Town"}),expect.objectContaining({label:"Profile location",value:"Metro Area"})]));
    expect(JSON.stringify(p)).toBe(before);
  });
  it("keeps home unknown when only a profile or generic location is recorded",()=>{
    const p=person();
    p.durableFacts.push(fact("unspecified","Location","Location","Metro Area"),fact("office","Work","Office location","Office Town"));
    const home=relationshipContactFields(p,today).find(field=>field.label==="Location");
    expect(home?.primary).toBeNull();
    expect(home?.values).toEqual([]);
  });

});
