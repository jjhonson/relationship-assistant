import { describe, expect, it } from "vitest";
import { getContact, getContacts } from "./contacts";
import { daysSince, describeGap, formatDate, initials } from "./format";

describe("contacts", () => {
  it("provides five contacts with required fields", () => {
    const all = getContacts();
    expect(all).toHaveLength(5);
    for (const c of all) {
      expect(c.name).toBeTruthy();
      expect(c.relationship).toBeTruthy();
      expect(c.lastInteraction).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.history.length).toBeGreaterThan(0);
      expect(c.plan.steps.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids and supports lookup", () => {
    const ids = getContacts().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getContact("maya-chen")?.name).toBe("Maya Chen");
    expect(getContact("nobody")).toBeUndefined();
  });
});

describe("format helpers", () => {
  it("formats dates", () => {
    expect(formatDate("2026-08-14")).toBe("August 14, 2026");
  });
  it("computes day gaps", () => {
    expect(daysSince("2026-01-01", new Date("2026-01-11T12:00:00Z"))).toBe(10);
  });
  it("describes gaps", () => {
    expect(describeGap(0)).toBe("Today");
    expect(describeGap(1)).toBe("1 day ago");
    expect(describeGap(65)).toBe("2 months ago");
    expect(describeGap(800)).toBe("2 years ago");
  });
  it("builds initials", () => {
    expect(initials("Maya Chen")).toBe("MC");
  });
});
