import { describe, expect, it } from "vitest";
import {
  applyCaptureExtraction,
  captureInterpretationText,
  isCaptureForRelationship,
  newCaptureEvent,
  newImageCaptureEvent,
  resolveCapturePerson,
  type CaptureExtraction,
  type CaptureParticipant,
} from "./capture";
import { createManualRelationshipRecord } from "./relationship-record";

const now = new Date("2026-11-17T18:00:00Z");

function person(name: string, other: Partial<CaptureParticipant> = {}): CaptureParticipant {
  return {
    name, email: "", phone: "", company: "", jobTitle: "", city: "", linkedin: "", facts: [],
    ...other,
  };
}

function extraction(participants: CaptureParticipant[], other: Partial<CaptureExtraction> = {}): CaptureExtraction {
  return { summary: "A remembered conversation.", participants, sharedDetails: [], otherPeople: [], commitments: [], ...other };
}

describe("universal text capture", () => {
  it("stores photo-derived text and visible details separately from user context, without an image payload", () => {
    const event = newImageCaptureEvent({
      note: "Holiday card from Arvin, my old colleague",
      sourceText: "Shubh Diwali!\nFrom Arvin and Cindy, Anjali and Sajai",
      visualDetails: "A white dog in a car, possibly with family members.",
    }, null, now);
    expect(event.source).toBe("user-image");
    expect(event.note).toBe("Holiday card from Arvin, my old colleague");
    expect(event.sourceText).toContain("Shubh Diwali!");
    expect(event.visualDetails).toContain("white dog");
    expect(JSON.stringify(event)).not.toContain("data:image/");
    expect(captureInterpretationText(event)).toContain("Text read from the selected photo");

    const interpreted = applyCaptureExtraction(event, extraction([person("Arvin")], {
      summary: "Received a holiday card from Arvin.",
      otherPeople: [{ name: "Cindy", connection: "Named in the sign-off" },
        { name: "Anjali", connection: "Named in the sign-off" },
        { name: "Sajai", connection: "Named in the sign-off" }],
      sharedDetails: ["A white dog appears in the photo."],
    }), [], now);
    expect(interpreted.relationships.map((item) => item.personLabel)).toEqual(["Arvin"]);
    expect(interpreted.event.otherPeople).toHaveLength(3);
    expect(interpreted.relationships[0].sources[0].label).toBe("Photo you chose (image not retained)");
    expect(interpreted.relationships[0].lastInteractionAt).toBeNull();
  });

  it("allows an image-only memory with no presumed relationship, but rejects empty photo results", () => {
    const event = newImageCaptureEvent({ note: "", sourceText: "", visualDetails: "An old team photo." }, null, now);
    const applied = applyCaptureExtraction(event, extraction([], { summary: "Team photograph." }), [], now);
    expect(applied.relationships).toHaveLength(0);
    expect(applied.event.status).toBe("interpreted");
    expect(() => newImageCaptureEvent({ note: "", sourceText: "", visualDetails: "" }, null, now)).toThrow();
  });

  it("creates two provisional neighbors from one note, preserves dogs as shared context, and leaves contact details unknown", () => {
    const event = newCaptureEvent(
      "Met Tom and Judy across the back fence. Their dogs are Pepper and Scout.", null, now,
    );
    const result = applyCaptureExtraction(event, extraction([person("Tom"), person("Judy")], {
      summary: "Introduced to neighbors across the fence.",
      sharedDetails: ["They are neighbors across the back fence.", "Their dogs are Pepper and Scout."],
    }), [], now);

    expect(result.event.note).toContain("Pepper and Scout");
    expect(result.event.status).toBe("interpreted");
    expect(result.event.people.map((p) => p.resolution)).toEqual(["created", "created"]);
    expect(result.relationships.map((r) => r.personLabel)).toEqual(["Tom", "Judy"]);
    expect(result.relationships.every((r) => r.personLabelAuthority === "inferred-unverified")).toBe(true);
    expect(result.relationships.every((r) => r.identities.length === 0 && r.durableFacts.length === 0)).toBe(true);
    expect(result.relationships.every((r) => isCaptureForRelationship(result.event, r.id))).toBe(true);
    expect(result.relationships[0].sources).toEqual([{
      id: "capture:" + event.id, source: "capture", observedAt: "2026-11-17", label: "Your saved note",
    }]);
  });

  it("creates a sparse conference contact with only grounded company and conversation context", () => {
    const event = newCaptureEvent("Met Samir from Northstar at a conference and talked about partnerships.", null, now);
    const result = applyCaptureExtraction(event, extraction([person("Samir", {
      company: "Northstar",
      facts: [{ category: "Work", label: "Discussion", value: "Partnerships" }],
    })]), [], now);
    const record = result.relationships[0];
    expect(record.personLabel).toBe("Samir");
    expect(record.durableFacts.map((f) => [f.label, f.value])).toEqual([
      ["Company", "Northstar"], ["Discussion", "Partnerships"],
    ]);
    expect(record.durableFacts.every((f) => f.sourceIds.includes("capture:" + event.id))).toBe(true);
    expect(record.identities).toHaveLength(0);
    expect(record.openLoops).toEqual([]);
    expect(record.lastInteractionAt).toBeNull(); // The note's save date is not proof of the meeting date.
  });

  it("updates an anchored existing relationship without creating a duplicate or erasing existing memory", () => {
    const existing = createManualRelationshipRecord("Samir Khan", "Former colleague", undefined, now);
    const event = newCaptureEvent("Caught up with Samir about his new role.", existing.id, now);
    const result = applyCaptureExtraction(event, extraction([person("Samir", {
      jobTitle: "Head of Partnerships",
    })]), [existing], now);
    expect(result.relationships).toHaveLength(1);
    expect(result.event.people[0]).toMatchObject({ resolution: "linked", relationshipId: existing.id });
    expect(result.relationships[0].relationshipContexts).toEqual(["Former colleague"]);
    expect(result.relationships[0].durableFacts[0]).toMatchObject({ label: "Role", value: "Head of Partnerships" });
    expect(result.relationships[0].sources.some((s) => s.id === "capture:" + event.id)).toBe(true);
    expect(isCaptureForRelationship(result.event, existing.id)).toBe(true);
  });

  it("does not silently merge or duplicate an ambiguous name; a user can resolve it", () => {
    const existing = createManualRelationshipRecord("Tom Wilson", undefined, undefined, now);
    const event = newCaptureEvent("Met Tom over the fence.", null, now);
    const result = applyCaptureExtraction(event, extraction([person("Tom")]), [existing], now);
    expect(result.relationships).toHaveLength(1);
    expect(result.event.people[0]).toMatchObject({
      resolution: "needs-review", relationshipId: null, candidateIds: [existing.id],
    });
    const linked = resolveCapturePerson(result.event, 0, existing.id, result.relationships, now);
    expect(linked.relationships).toHaveLength(1);
    expect(linked.event.people[0]).toMatchObject({ resolution: "linked", relationshipId: existing.id });

    const distinct = resolveCapturePerson(result.event, 0, "new", result.relationships, now);
    expect(distinct.relationships).toHaveLength(2);
    expect(distinct.event.people[0].resolution).toBe("created");
    expect(() => resolveCapturePerson(result.event, 0, "other-id", result.relationships, now)).toThrow();
    expect(() => resolveCapturePerson(linked.event, 0, "new", linked.relationships, now)).toThrow();
  });

  it("links when a grounded email matches, but stores new email evidence as unverified", () => {
    const existing = createManualRelationshipRecord("Jamie Example", undefined, undefined, now);
    existing.identities.push({
      id: "email-1", kind: "email", value: "jamie@example.org", source: "gmail",
      label: "Jamie Example", confirmed: true, sourceIds: ["gmail-1"],
    });
    const event = newCaptureEvent("Met Jamie from the example team; email jamie@example.org.", null, now);
    const result = applyCaptureExtraction(event, extraction([person("Jamie", {
      email: "jamie@example.org", phone: "555-0102",
    })]), [existing], now);
    expect(result.relationships).toHaveLength(1);
    expect(result.event.people[0].relationshipId).toBe(existing.id);
    expect(result.relationships[0].durableFacts[0]).toMatchObject({ label: "Phone", value: "555-0102" });
    expect(result.relationships[0].identities[0].confirmed).toBe(true);
    expect(result.relationships[0].identities[0].sourceIds).toContain("capture:" + event.id);
  });

  it("keeps a note with no identified person and does not manufacture any obligation", () => {
    const event = newCaptureEvent("I heard an interesting idea at the conference.", null, now);
    const result = applyCaptureExtraction(event, extraction([], { summary: "Noted an idea at a conference." }), [], now);
    expect(result.relationships).toHaveLength(0);
    expect(result.event.note).toBe(event.note);
    expect(result.event.people).toEqual([]);
    expect(result.event.commitments).toEqual([]);
  });

  it("starts in a durable pending state and refuses empty or oversized notes", () => {
    const event = newCaptureEvent("Remember this, even when inference is unavailable.", null, now);
    expect(event.status).toBe("pending");
    expect(event.note).toContain("even when inference is unavailable");
    expect(() => newCaptureEvent("   ", null, now)).toThrow();
    expect(() => newCaptureEvent("x".repeat(5001), null, now)).toThrow();
  });
});
