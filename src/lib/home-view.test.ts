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
    const invalid = person("Invalid", "2026-02-30");
    expect(orderHomeRelationships([invalid, older]).map((x) => x.personLabel))
      .toEqual(["Older", "Invalid"]);
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

describe("Home reasons to connect: why now, not just a remembered subject", () => {
  const today = "2026-11-27";
  const select = (people: ReturnType<typeof person>[]) => selectHomeOpportunities(people, "Jason", 3, today);
  it("does not suggest follow-up on a recent long-horizon plan", () => {
    const p = sourcedThread("Avery", "2026-11-23");
    p.inferredRelationshipContexts = [{ value: "Former colleague", sourceIds: ["source:Avery"],
      verification: "Unverified", lastSuggestedAt: "2026-11-23" }];
    p.activeThreads[0].topic = "Longer-term career change";
    p.activeThreads[0].state = "Might relocate after their children finish school";
    p.activeThreads[0].nextChangeSignal = "Several years from now";
    expect(select([p])).toEqual([]);
    expect(buildConnectionCandidates(p, "Jason").some((item) => item.kind === "thread")).toBe(true);
  });

  it("does not manufacture a reason from an unknown date or an interest alone", () => {
    const p = person("Fictional Avery");
    p.sources.push({ id: "source:avery", source: "manual", observedAt: "2026-11-15", label: "Saved note" });
    p.durableFacts.push({ id: "guitar", category: "Interest", label: "Hobby", value: "Learning guitar",
      firstObservedAt: "2026-11-15", lastObservedAt: "2026-11-15", sourceIds: ["source:avery"] });
    p.openLoops.push({ owner: "Jason", commitment: "Send an email", status: "Open", sourceIds: [] });
    p.contactCadenceDays = 30;
    expect(select([p])).toEqual([]);
  });

  it("offers a catch-up at an appropriate cadence without treating a future plan as a current event", () => {
    const p = sourcedThread("Avery", "2026-05-01");
    p.inferredRelationshipContexts = [{ value: "Former colleague", sourceIds: ["source:Avery"],
      verification: "Unverified", lastSuggestedAt: "2026-05-01" }];
    const selected = select([p]);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ personLabel: "Avery", kind: "cadence", topic: "Time to catch up?",
      basisId: "cadence:2026-05-01:180", observedAt: "2026-05-01" });
    expect(selected[0].context).toContain("about every 6 months");
    expect(selected[0].context).not.toContain("5K");
  });

  it("prioritizes a sourced commitment you made over normal cadence, never someone else's promise", () => {
    const p = sourcedThread("Avery", "2026-11-23");
    p.contactCadenceDays = 180;
    p.openLoops.push(
      { owner: "Other person", commitment: "Send you photos", status: "Open", sourceIds: ["source:Avery"] },
      { owner: "Jason", commitment: "Send the training article", status: "Open", sourceIds: ["source:Avery"] },
      { owner: "Jason", commitment: "Unverified idea", status: "Unclear", sourceIds: ["source:Avery"] },
    );
    expect(select([p]).map((item) => [item.kind, item.topic])).toEqual([["commitment", "Send the training article"]]);
    const candidate = buildConnectionCandidates(p, "Jason").find((c) => c.kind === "commitment")!;
    const dismissed = dismissConnectionCandidate(p, candidate);
    expect(select([dismissed])).toEqual([]);
    expect(dismissed.sources).toEqual(p.sources);
    expect(dismissed.openLoops).toEqual(p.openLoops);
  });

  it("honors overrides and shows at most one item per person and three overall", () => {
    const people = ["A", "B", "C", "D"].map((name, i) => sourcedThread(name, "2026-05-0" + String(i + 1)));
    for (const p of people) p.contactCadenceDays = 90;
    people[3].contactCadenceDays = 0;
    expect(select(people).map((item) => item.personLabel)).toEqual(["A", "B", "C"]);
    people[3].openLoops.push({ owner: "User", commitment: "Share the article", status: "Overdue", sourceIds: ["source:D"] });
    expect(select(people).map((item) => item.personLabel)).toEqual(["D", "A", "B"]);
  });

  it("does not revive a dismissed catch-up until a genuinely new contact cycle", () => {
    const p = sourcedThread("Avery", "2026-05-01");
    p.contactCadenceDays = 180;
    p.dismissedCadenceCycle = "cadence:2026-05-01:180";
    expect(select([p])).toEqual([]);
    p.lastInteractionAt = "2026-05-10";
    expect(select([p])[0].basisId).toBe("cadence:2026-05-10:180");
  });
});
