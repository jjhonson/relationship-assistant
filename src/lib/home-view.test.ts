import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import { dismissConnectionCandidate, buildConnectionCandidates } from "./connection-subjects";
import { homeInteractionDate, homeRelationshipDetail, orderHomeRelationships, selectHomeOpportunities } from "./home-view";

function person(name: string, lastInteractionAt: string | null = null) {
  const result = createManualRelationshipRecord(name);
  result.lastInteractionAt = lastInteractionAt;
  return result;
}
function sourcedThread(name: string, day: string) {
  const p = person(name, day);
  p.sources.push({
    id: "source:" + name, source: "capture", observedAt: day, label: "Fictional conversation",
  });
  p.activeThreads.push({
    id: "thread:" + name, topic: "Considering a local 5K",
    state: "Mentioned training but had not registered",
    whyItMatters: "Trying something new", nextChangeSignal: "Possibly in December",
    sourceIds: ["source:" + name], lastObservedAt: day,
  });
  return p;
}

describe("quiet Home relationship list", () => {
  it("orders oldest known interactions before newer dates and leaves unknown last", () => {
    const never = person("Unknown");
    never.updatedAt = "2029-12-01T10:00:00Z";
    const newer = person("Newer", "2026-11-24");
    const older = person("Older", "2026-09-18");
    expect(orderHomeRelationships([never, newer, older]).map((x) => x.personLabel))
      .toEqual(["Older", "Newer", "Unknown"]);
    expect(homeInteractionDate(null)).toBe("Not recorded");
    expect(homeInteractionDate("2026-11-24")).toBe("Nov 24, 2026");
    expect(homeInteractionDate("2026-02-30")).toBe("Not recorded");
  });

  it("does not invent relationship details for unsourced profiles", () => {
    const p = person("Fictional Judy");
    p.durableFacts.push({
      id: "unsourced", label: "Hobby", category: "Interest",
      value: "Loves marathons", sourceIds: ["source-that-does-not-exist"],
      firstObservedAt: "2026-11-20", lastObservedAt: "2026-11-20",
    });
    expect(homeRelationshipDetail(p)).toBeNull();
  });
});

describe("evidence-backed Home conversation opportunities", () => {
  it("is genuinely empty without sourced topical context", () => {
    const p = person("Fictional Judy");
    p.openLoops.push({ owner: "Jason", commitment: "Send an email",
      status: "Open", sourceIds: [] });
    expect(selectHomeOpportunities([p], "Jason")).toEqual([]);
  });

  it("displays a clear topic, saved state and provenance without declaring the race completed", () => {
    const p = sourcedThread("Judy", "2026-11-20");
    const selected = selectHomeOpportunities([p], "Jason");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      personLabel: "Judy",
      topic: "Considering a local 5K",
      basisId: "thread:thread:Judy",
      observedAt: "2026-11-20",
      evidence: [{ id: "source:Judy", label: "Fictional conversation" }],
    });
    expect(selected[0].context).toContain("had not registered");
    expect(selected[0].context).not.toContain("ran the race");
  });

  it("dismisses one idea persistently but does not erase the source or the person", () => {
    const p = sourcedThread("Judy", "2026-11-20");
    const [candidate] = buildConnectionCandidates(p, "Jason")
      .filter((item) => item.kind === "thread");
    const dismissed = dismissConnectionCandidate(p, candidate);
    expect(selectHomeOpportunities([dismissed], "Jason")).toEqual([]);
    expect(dismissed.sources).toEqual(p.sources);
    expect(dismissed.activeThreads).toEqual(p.activeThreads);
  });

  it("uses at most one sourced idea per person, at most three, and newest evidence first", () => {
    const people = ["A", "B", "C", "D"].map((name, i) =>
      sourcedThread(name, "2026-11-" + String(i + 1).padStart(2,"0")));
    people[0].durableFacts.push({
      id: "secondary", category: "Interest", label: "Running",
      value: "Learning to run", firstObservedAt: "2026-11-01",
      lastObservedAt: "2026-11-01", sourceIds: ["source:A"],
    });
    expect(selectHomeOpportunities(people, "Jason").map((v) => v.personLabel))
      .toEqual(["D", "C", "B"]);
  });

  it("can include a sourced personal interest but never an unsourced one", () => {
    const p = person("Fictional Tom");
    p.sources.push({ id: "source:tom", source: "manual",
      observedAt: "2026-11-15", label: "Saved conversation" });
    p.durableFacts.push({ id: "guitar", category: "Interest", label: "Hobby",
      value: "Learning guitar", firstObservedAt: "2026-11-15",
      lastObservedAt: "2026-11-15", sourceIds: ["source:tom"] });
    expect(selectHomeOpportunities([p], "Jason")[0].topic).toBe("Learning guitar");
  });
});
