import { describe, expect, it } from "vitest";
import { planRepresentativeEvidence } from "./evidence-planner";
import type { ThreadCandidate } from "../real-contact-pilot";

const confirmed = "person-a@example.test";

function candidate(
  id: string,
  firstDate: string,
  lastDate: string,
  messageCount: number,
  participantAddresses = [confirmed, "owner@example.test"],
  flags: Partial<Pick<ThreadCandidate, "isAutomated" | "isCalendarArtifact" | "isDraft" | "isGroupOnly">> = {},
): ThreadCandidate {
  return {
    id,
    subject: `Synthetic subject ${id}`,
    firstDate,
    lastDate,
    messageCount,
    participantAddresses,
    isGroupOnly: false,
    ...flags,
  };
}

describe("metadata-only representative evidence planning", () => {
  it("balances recent activity with older exchange candidates and excludes obvious noise", () => {
    const candidates = [
      candidate("recent", "2026-06-02", "2026-06-10", 3),
      candidate("historical", "2022-02-01", "2022-10-01", 8),
      candidate("anchor", "2018-04-01", "2018-04-12", 2),
      candidate("calendar", "2026-06-09", "2026-06-09", 1, undefined, { isCalendarArtifact: true }),
      candidate("automated", "2025-01-01", "2025-01-03", 4, undefined, { isAutomated: true }),
      candidate("draft", "2024-01-01", "2024-01-03", 4, undefined, { isDraft: true }),
      candidate("group", "2023-01-01", "2023-01-03", 4, [
        confirmed,
        "owner@example.test",
        "third-party@example.test",
      ], { isGroupOnly: true }),
      candidate("self-addressed", "2025-12-01", "2025-12-01", 1, [confirmed]),
      candidate("unrelated", "2026-06-01", "2026-06-10", 7, ["other-person@example.test"]),
      candidate("isolated", "2026-06-01", "2026-06-01", 1),
    ];

    const recommendations = planRepresentativeEvidence(
      candidates,
      [confirmed],
      new Date("2026-06-15T00:00:00Z"),
    );

    expect(recommendations.map(({ conversationId }) => conversationId)).toEqual([
      "recent",
      "historical",
      "anchor",
    ]);
    expect(recommendations.map(({ role }) => role)).toEqual([
      "Recent activity",
      "Long-running exchange candidate",
      "Early relationship anchor",
    ]);
    expect(recommendations.every(({ reason }) => reason.length > 0)).toBe(true);
    expect(recommendations.every(({ candidate: item }) =>
      item.participantAddresses.includes(confirmed),
    )).toBe(true);
    expect(recommendations).toHaveLength(3);
    expect(
      planRepresentativeEvidence(candidates, [confirmed], new Date("2026-06-15T00:00:00Z")),
    ).toEqual(recommendations);
  });

  it("keeps a single-message recent conversation when stronger historical exchanges exist", () => {
    const recommendations = planRepresentativeEvidence(
      [
        candidate("recent-single", "2026-06-14", "2026-06-14", 1),
        candidate("historical", "2022-02-01", "2022-10-01", 8),
        candidate("anchor", "2018-04-01", "2018-04-12", 2),
      ],
      [confirmed],
      new Date("2026-06-15T00:00:00Z"),
    );

    expect(recommendations.map(({ conversationId }) => conversationId)).toEqual([
      "recent-single",
      "historical",
      "anchor",
    ]);
    expect(recommendations[0].role).toBe("Recent activity");
  });

  it("uses the adapter's message-aware group-only flag", () => {
    const recommendations = planRepresentativeEvidence(
      [
        candidate(
          "two-owner-addresses",
          "2021-01-01",
          "2021-04-01",
          4,
          [confirmed, "owner-one@example.test", "owner-two@example.test"],
        ),
        candidate(
          "mixed-direct-and-group",
          "2022-01-01",
          "2022-06-01",
          5,
          [confirmed, "owner-one@example.test", "colleague@example.test"],
        ),
        candidate(
          "group-only",
          "2023-01-01",
          "2023-06-01",
          6,
          [confirmed, "owner-one@example.test", "colleague@example.test"],
          { isGroupOnly: true },
        ),
      ],
      [confirmed],
      new Date("2026-06-15T00:00:00Z"),
    );

    expect(recommendations.map(({ conversationId }) => conversationId)).toEqual([
      "mixed-direct-and-group",
      "two-owner-addresses",
    ]);
  });

  it("does not recommend a self-addressed or BCC-style message with no visible counterparty", () => {
    expect(
      planRepresentativeEvidence(
        [candidate("self-addressed", "2026-06-14", "2026-06-14", 1, [confirmed])],
        [confirmed],
        new Date("2026-06-15T00:00:00Z"),
      ),
    ).toEqual([]);
  });

  it("degrades gracefully for sparse history without inventing recent activity", () => {
    const recommendations = planRepresentativeEvidence(
      [candidate("only-old", "2017-05-01", "2017-05-01", 1)],
      [confirmed],
      new Date("2026-06-15T00:00:00Z"),
    );

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      conversationId: "only-old",
      role: "Early relationship anchor",
    });
    expect(recommendations[0].reason).toContain("sampled date");
  });

  it("returns no recommendations without a confirmed identity match", () => {
    expect(
      planRepresentativeEvidence(
        [candidate("unconfirmed", "2026-06-01", "2026-06-10", 4)],
        ["other-person@example.test"],
        new Date("2026-06-15T00:00:00Z"),
      ),
    ).toEqual([]);
  });
});
