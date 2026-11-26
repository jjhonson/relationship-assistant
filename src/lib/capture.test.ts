import { describe, expect, it } from "vitest";
import {
  applyCaptureExtraction,
  captureInterpretationText,
  connectedPeopleFromCaptures,
  dismissCapturedConnection,
  isCaptureForRelationship,
  newCaptureEvent,
  newImageCaptureEvent,
  resolveCapturePerson,
  sharedHouseholdContextFromCaptures,
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

describe("explicit user-reported conversation dates", () => {
  it("distinguishes the reported encounter day from the actual time the note was captured", () => {
    const captured = new Date("2026-11-26T01:35:00.000Z"); // Nov 25 in Denver
    const judy = createManualRelationshipRecord("Fictional Judy Test");
    const event = newCaptureEvent(
      "I spoke with Fictional Judy Test yesterday. She is considering a 5K.",
      judy.id, captured, {
        reportedInteractionAt: "2026-11-24",
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    );
    expect(event.capturedAt).toBe("2026-11-26T01:35:00.000Z");
    expect(event.reportedInteractionAt).toBe("2026-11-24");
    const applied = applyCaptureExtraction(event, extraction([person("Fictional Judy Test")]), [judy], captured);
    expect(applied.relationships[0].lastInteractionAt).toBe("2026-11-24");
    expect(applied.relationships[0].sources[1].observedAt).toBe("2026-11-24");
    expect(applied.event.capturedAt).toBe("2026-11-26T01:35:00.000Z");
  });

  it("dates an explicitly new single-person encounter but not incidental people in a group note", () => {
    const single = newCaptureEvent("I met Alex yesterday.", null, now, {
      reportedInteractionAt: "2026-11-16",
    });
    const applied = applyCaptureExtraction(single, extraction([person("Alex")]), [], now);
    expect(applied.relationships[0].lastInteractionAt).toBe("2026-11-16");

    const group = newCaptureEvent("I heard about Tom and Judy yesterday.", null, now, {
      reportedInteractionAt: "2026-11-16",
    });
    const twoPeople = applyCaptureExtraction(group, extraction([person("Tom"), person("Judy")]), [], now);
    expect(twoPeople.relationships.every((person) => person.lastInteractionAt === null)).toBe(true);
  });
});

describe("universal text capture", () => {
  it("keeps explicit household connections source-backed and shares later household context without inventing a Judy interaction", () => {
    const first = applyCaptureExtraction(newCaptureEvent(
      "Met Tom and Judy, who live together next door. Their dogs are Pepper and Scout.", null, now,
    ), extraction([person("Tom"), person("Judy")], {
      sharedDetails: ["Their dogs are Pepper and Scout."],
      householdDetails: ["Their household has dogs Pepper and Scout."],
      connections: [{ firstName: "Tom", secondName: "Judy", kind: "household", description: "Share a home next door." }],
    }), [], now);
    const [tom, judy] = first.relationships;
    expect(first.event.connections).toMatchObject([{
      firstRelationshipId: tom.id, secondRelationshipId: judy.id, dismissed: false, kind: "household",
    }]);
    expect(connectedPeopleFromCaptures([first.event], judy.id)[0].relatedRelationshipId).toBe(tom.id);

    const secondDate = new Date("2026-11-18T18:00:00Z");
    const second = applyCaptureExtraction(newCaptureEvent(
      "Tom said they moved from Austin in October and the dogs are settling in.", tom.id, secondDate,
    ), extraction([person("Tom")], {
      sharedDetails: ["Their household moved from Austin in October."],
      householdDetails: ["The household moved from Austin in October (year not specified)."],
    }), first.relationships, secondDate);

    expect(second.relationships).toHaveLength(2);
    expect(second.relationships.find((item) => item.id === judy.id)?.durableFacts).toEqual([]);
    expect(isCaptureForRelationship(second.event, judy.id)).toBe(false);
    const shared = sharedHouseholdContextFromCaptures([first.event, second.event], judy.id);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ event: { id: second.event.id }, viaRelationshipId: tom.id });
    expect(shared[0].detail).toContain("year not specified");

    const dismissed = dismissCapturedConnection(first.event, first.event.connections![0].id, judy.id);
    expect(connectedPeopleFromCaptures([dismissed], judy.id)).toEqual([]);
    expect(sharedHouseholdContextFromCaptures([dismissed, second.event], judy.id)).toEqual([]);
  });

  it("does not infer a household from a shared encounter or create incidental children as contacts", () => {
    const result = applyCaptureExtraction(newCaptureEvent(
      "Met Sam and Lee at a conference. Sam said daughter Lily is learning guitar.", null, now,
    ), extraction([person("Sam"), person("Lee")], {
      otherPeople: [{ name: "Lily", connection: "Sam's daughter, learning guitar" }],
      sharedDetails: ["All attended the same conference."],
      connections: [{ firstName: "Sam", secondName: "Lily", kind: "family", description: "Sam's daughter" }],
    }), [], now);
    expect(result.relationships.map((record) => record.personLabel)).toEqual(["Sam", "Lee"]);
    expect(connectedPeopleFromCaptures([result.event], result.relationships[0].id)).toEqual([]);
    expect(sharedHouseholdContextFromCaptures([result.event], result.relationships[1].id)).toEqual([]);
    expect(result.event.connections?.[0].secondRelationshipId).toBeNull();
  });

  it("waits for ambiguous identity resolution before activating an explicit person link", () => {
    const existing = createManualRelationshipRecord("Tom Wilson", undefined, undefined, now);
    const first = applyCaptureExtraction(newCaptureEvent("Tom and Judy share a household.", null, now),
      extraction([person("Tom"), person("Judy")], {
        connections: [{ firstName: "Tom", secondName: "Judy", kind: "household", description: "Live together." }],
      }), [existing], now);
    const judy = first.relationships.find((record) => record.personLabel === "Judy")!;
    expect(connectedPeopleFromCaptures([first.event], judy.id)).toEqual([]);
    const resolved = resolveCapturePerson(first.event, 0, existing.id, first.relationships, now);
    expect(connectedPeopleFromCaptures([resolved.event], judy.id)[0].relatedRelationshipId).toBe(existing.id);
  });

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
