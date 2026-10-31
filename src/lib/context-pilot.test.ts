import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PILOT_THREADS,
  buildPilotBrief,
  canReviewPilotContact,
  pilotContacts,
} from "./context-pilot";

afterEach(() => vi.unstubAllGlobals());

describe("fictional contextual relationship pilot", () => {
  it("covers the five varied fictional contact archetypes with bounded evidence", () => {
    expect(pilotContacts).toHaveLength(5);
    expect(pilotContacts.map((contact) => contact.id)).toEqual([
      "frequent-family",
      "lodging-host",
      "recruiter",
      "new-coworker",
      "dormant-professional",
    ]);
    expect(pilotContacts.every((contact) => contact.threads.length <= MAX_PILOT_THREADS)).toBe(true);
    expect(pilotContacts.every((contact) => contact.unknowns.length > 0)).toBe(true);
  });

  it("does not provide evidence before explicit review consent", () => {
    expect(canReviewPilotContact("recruiter", false)).toBe(false);
    expect(canReviewPilotContact("", true)).toBe(false);
    expect(canReviewPilotContact("not-a-contact", true)).toBe(false);
    expect(buildPilotBrief("recruiter", false)).toBeUndefined();
  });

  it("does not make content requests when reviewing fictional evidence", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    buildPilotBrief("frequent-family", false);
    buildPilotBrief("frequent-family", true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns only the selected contact's bounded fictional evidence after consent", () => {
    expect(canReviewPilotContact("recruiter", true)).toBe(true);
    const brief = buildPilotBrief("recruiter", true);
    expect(brief?.threads).toHaveLength(2);
    expect(brief?.threads.every((thread) => thread.id.startsWith("recruiter-"))).toBe(true);
  });

  it("does not confuse email volume with significance or maintenance", () => {
    const frequent = buildPilotBrief("frequent-family", true);
    const transactional = buildPilotBrief("lodging-host", true);
    const dormant = buildPilotBrief("dormant-professional", true);

    expect(frequent).toMatchObject({ significance: expect.stringContaining("mutual support"), recommendation: "No action needed" });
    expect(transactional).toMatchObject({ significance: expect.stringContaining("completed transaction"), recommendation: "No action needed" });
    expect(dormant).toMatchObject({
      significance: expect.stringContaining("Sparse email spans years"),
      maintenance: expect.stringContaining("not proof"),
      recommendation: "Worthwhile reconnection",
    });
  });

  it("keeps ambiguous recruiter and coworker evidence open to user judgment", () => {
    expect(buildPilotBrief("recruiter", true)).toMatchObject({
      confidence: "Low",
      recommendation: "Research more",
      unknowns: [expect.stringContaining("outcome")],
    });
    expect(buildPilotBrief("new-coworker", true)).toMatchObject({
      confidence: "Low",
      recommendation: "User judgment needed",
      unknowns: [expect.stringContaining("Work chat")],
    });
  });
});
