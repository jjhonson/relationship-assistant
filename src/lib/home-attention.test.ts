import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import { selectHomeAttention } from "./home-attention";
import { suggestHomePerson } from "./home-identity";

function record(name: string, id: string) {
  return { ...createManualRelationshipRecord(name), id };
}

describe("grounded Home attention", () => {
  it("is empty for no relationships or only sparse ones", () => {
    expect(selectHomeAttention([], "Jason")).toEqual({ commitments: [], possibleSubjects: [] });
    expect(selectHomeAttention([record("Tom", "tom")], "Jason"))
      .toEqual({ commitments: [], possibleSubjects: [] });
  });

  it("only surfaces a sourced user-owned commitment, not someone else's promise", () => {
    const tom = record("Tom", "tom");
    tom.sources = [{ id: "source-1", source: "manual", observedAt: "2026-11-22",
      label: "Manually pasted meeting or call" }];
    tom.openLoops = [
      { commitment: "Send Tom the beginner-guitar resource", owner: "Jason",
        status: "Open", sourceIds: ["source-1"] },
      { commitment: "Tom will send an update", owner: "Tom",
        status: "Open", sourceIds: ["source-1"] },
      { commitment: "A model guessed a reminder", owner: "Jason",
        status: "Open", sourceIds: ["missing"] },
      { commitment: "Uncertain promise", owner: "Jason",
        status: "Unclear", sourceIds: ["source-1"] },
    ];
    const result = selectHomeAttention([tom], "Jason");
    expect(result.commitments).toHaveLength(1);
    expect(result.commitments[0]).toMatchObject({
      personLabel: "Tom", subject: "Send Tom the beginner-guitar resource",
      observedAt: "2026-11-22",
    });
    expect(result.commitments[0].detail).toContain("verify before acting");
    expect(result.possibleSubjects).toHaveLength(0);
  });

  it("shows dated active threads as possible subjects, never assumed obligations", () => {
    const records = ["Tom", "Judy", "Kiran", "Avery"].map((name, index) => {
      const person = record(name, String(index));
      const day = String(index + 1).padStart(2, "0");
      person.sources = [{ id: "s-" + index, source: "capture",
        observedAt: "2026-11-" + day, label: "Saved note" }];
      person.activeThreads = [{
        id: "t-" + index, topic: "Topic for " + name, state: "Possibly progressing",
        whyItMatters: "A recent conversation", nextChangeSignal: "A later update",
        sourceIds: ["s-" + index], lastObservedAt: "2026-11-" + day,
      }];
      return person;
    });
    const result = selectHomeAttention(records, "Jason");
    expect(result.commitments).toHaveLength(0);
    expect(result.possibleSubjects).toHaveLength(3);
    expect(result.possibleSubjects[0].personLabel).toBe("Avery");
    expect(result.possibleSubjects[0].detail).toContain("not a confirmed current development");
  });
});

describe("local Home person suggestion", () => {
  const people = [
    { id: "tom", label: "Tom Wilson" }, { id: "judy", label: "Judy" },
    { id: "other", label: "Tom Sawyer" },
  ];
  it("suggests a uniquely named saved person, without writing", () => {
    expect(suggestHomePerson("Just finished a call with Tom Wilson.", people))
      .toEqual({ id: "tom", ambiguous: false });
    expect(suggestHomePerson("Judy: Let's meet later.\nMe: OK.", people))
      .toEqual({ id: "judy", ambiguous: false });
  });
  it("does not guess when first names collide or two people appear", () => {
    expect(suggestHomePerson("I met Tom today.", people))
      .toEqual({ id: null, ambiguous: true });
    expect(suggestHomePerson("Judy and Tom Wilson spoke today.", people))
      .toEqual({ id: null, ambiguous: true });
  });
  it("does not invent a relationship when no saved person matches", () => {
    expect(suggestHomePerson("My thoughts on learning guitar.", people))
      .toEqual({ id: null, ambiguous: false });
  });
});
