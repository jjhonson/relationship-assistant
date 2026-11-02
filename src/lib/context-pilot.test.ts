import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PILOT_THREADS,
  buildPilotBrief,
  canReviewPilotContact,
  getEffectivePilotInterpretation,
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
    expect(pilotContacts.every((contact) => buildPilotBrief(contact.id, false) === undefined)).toBe(true);
  });

  it("uses only bundled fictional records and makes no content requests", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const contact of pilotContacts) {
      expect(contact.threads.every((thread) => !thread.from.includes("@") && !thread.to.includes("@"))).toBe(true);
      buildPilotBrief(contact.id, false);
      buildPilotBrief(contact.id, true);
    }
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

  it("keeps authored suggestions separate from the user's effective corrections", () => {
    const brief = buildPilotBrief("recruiter", true);
    expect(brief).toBeDefined();
    expect(getEffectivePilotInterpretation(brief!)).toEqual({
      suggestedClassification: "Recruiter",
      effectiveClassification: "Recruiter",
      suggestedRecommendation: "Research more",
      effectiveRecommendation: "Research more",
    });

    expect(getEffectivePilotInterpretation(brief!, {
      classification: "Professional contact",
      recommendation: "No action needed",
    })).toEqual({
      suggestedClassification: "Recruiter",
      effectiveClassification: "Professional contact",
      suggestedRecommendation: "Research more",
      effectiveRecommendation: "No action needed",
    });
  });
});
