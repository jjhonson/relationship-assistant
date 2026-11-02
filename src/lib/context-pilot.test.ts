import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PILOT_THREADS,
  buildPilotBrief,
  canReviewPilotContact,
  getAssistancePlan,
  getEffectivePilotInterpretation,
  getPilotHistory,
  normalizePilotCorrection,
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

    expect(frequent).toMatchObject({ significance: expect.stringContaining("mutual support"), state: "Active" });
    expect(transactional).toMatchObject({ significance: expect.stringContaining("completed transaction"), state: "Dormant" });
    expect(dormant).toMatchObject({
      significance: expect.stringContaining("Sparse email spans years"),
      maintenance: expect.stringContaining("not proof"),
      state: "Dormant",
    });
  });

  it("keeps ambiguous recruiter and coworker evidence low-confidence with unknowns", () => {
    expect(buildPilotBrief("recruiter", true)).toMatchObject({
      confidence: "Low",
      state: "Unclear",
      unknowns: [expect.stringContaining("outcome")],
    });
    expect(buildPilotBrief("new-coworker", true)).toMatchObject({
      confidence: "Low",
      unknowns: [expect.stringContaining("Work chat")],
    });
  });

  it("provides richer fields grounded in each contact's own fictional threads", () => {
    for (const contact of pilotContacts) {
      const ids = new Set(contact.threads.map((thread) => thread.id));
      const cited = [
        ...contact.tags.flatMap((tag) => tag.sources),
        ...contact.stateSources,
        ...contact.openLoops.flatMap((loop) => loop.sources),
        ...contact.engagementReasons.flatMap((item) => item.sources),
        ...contact.developments.flatMap((item) => item.sources),
        contact.history.firstMeaningfulThreadId,
        contact.history.mostRecentMeaningfulThreadId,
      ];
      expect(contact.categories.length).toBeGreaterThan(0);
      expect(contact.tags.length).toBeGreaterThan(0);
      expect(cited.every((id) => ids.has(id))).toBe(true);
    }
    expect(buildPilotBrief("dormant-professional", true)?.tags.length).toBeGreaterThan(1);
  });

  it("derives relationship history from the cited threads", () => {
    expect(getPilotHistory(buildPilotBrief("dormant-professional", true)!)).toMatchObject({
      firstMeaningful: "2019-03-19",
      mostRecentMeaningful: "2023-06-17",
      span: "about 4 years",
    });
    expect(getPilotHistory(buildPilotBrief("lodging-host", true)!)?.span).toBe("same day");
  });

  it("does not keep clearly past plans as current open loops", () => {
    expect(buildPilotBrief("frequent-family", true)?.openLoops).toEqual([]);
    expect(buildPilotBrief("recruiter", true)?.openLoops).toEqual([
      expect.objectContaining({
        commitment: expect.stringContaining("role description"),
        owner: "Morgan Reed",
        status: "Unclear",
        lastMentioned: "2026-08-05",
      }),
    ]);
    expect(buildPilotBrief("new-coworker", true)?.openLoops).toEqual([
      expect.objectContaining({
        commitment: expect.stringContaining("Compare notes"),
        status: "Unclear",
      }),
    ]);
    expect(buildPilotBrief("lodging-host", true)?.openLoops).toEqual([]);
  });

  it("surfaces current or unclear open loops for either goal but reconnection reasons only when the user wants to stay better connected", () => {
    const brief = buildPilotBrief("dormant-professional", true)!;
    for (const goal of [undefined, "This feels right"] as const) {
      const plan = getAssistancePlan(brief, goal);
      expect(plan.openLoops).toEqual(brief.openLoops);
      expect(plan.openLoops).toEqual([]);
      expect(plan.reasonsToEngage).toEqual([]);
      expect(plan.proactiveNudges).toBe(false);
    }
    const connected = getAssistancePlan(brief, "I want to stay better connected");
    expect(connected.proactiveNudges).toBe(true);
    expect(connected.reasonsToEngage).toEqual(brief.engagementReasons);
    expect(connected.openLoops).toEqual(brief.openLoops);
    expect(connected.reasonsToEngage.length).toBeGreaterThan(0);
  });

  it("clears a correction when the user returns to the authored suggestion", () => {
    expect(normalizePilotCorrection("Recruiter", "Professional contact")).toBe("Professional contact");
    expect(normalizePilotCorrection("Recruiter", "Recruiter")).toBeUndefined();
    expect(normalizePilotCorrection("Dormant", "Active")).toBe("Active");
    expect(normalizePilotCorrection("Dormant", "Dormant")).toBeUndefined();
  });

  it("keeps authored suggestions separate from the user's effective corrections", () => {
    const brief = buildPilotBrief("recruiter", true);
    expect(brief).toBeDefined();
    expect(getEffectivePilotInterpretation(brief!)).toEqual({
      suggestedClassification: "Recruiter",
      effectiveClassification: "Recruiter",
      suggestedState: "Unclear",
      effectiveState: "Unclear",
    });

    expect(getEffectivePilotInterpretation(brief!, {
      classification: "Professional contact",
      state: "Dormant",
    })).toEqual({
      suggestedClassification: "Recruiter",
      effectiveClassification: "Professional contact",
      suggestedState: "Unclear",
      effectiveState: "Dormant",
    });
  });
});
