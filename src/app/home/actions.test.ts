import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  listRelationships: vi.fn(),
  savePersonalMoment: vi.fn(),
  saveReviewedPersonCapture: vi.fn(),
  saveQuickCaptureWithoutRedirect: vi.fn(),
  interpretConversationalCapture: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/relationship-store", () => ({
  listRelationships: mocks.listRelationships, savePersonalMoment: mocks.savePersonalMoment,
}));
vi.mock("@/lib/conversational-capture", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/conversational-capture")>();
  return { ...original, interpretConversationalCapture: mocks.interpretConversationalCapture };
});
vi.mock("@/app/relationships/conversational-actions", () => ({
  saveReviewedPersonCapture: mocks.saveReviewedPersonCapture,
}));
vi.mock("@/app/relationships/capture-actions", () => ({
  saveQuickCaptureWithoutRedirect: mocks.saveQuickCaptureWithoutRedirect,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { previewHomeInput, saveHomeInput } from "./actions";

const base = {
  text: "Just finished a meeting with Tom. Here's a transcript:\nTom: I like watercolor.\nMe: That's great.",
  kind: "conversation" as const, source: "meeting" as const,
  interactionDate: "2026-11-23", relationshipId: "tom",
};

describe("Home review/save privacy and identity boundaries", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.clearAllMocks();
    mocks.listRelationships.mockResolvedValue([{ id: "tom", personLabel: "Tom" }]);
    mocks.interpretConversationalCapture.mockResolvedValue({
      kind: "conversation", source: "meeting", interactionDate: "2026-11-23",
      dateEvidence: "relative", summary: "A meeting", question: "",
    });
    mocks.saveReviewedPersonCapture.mockResolvedValue({
      saved: true, destination: "/relationships/tom?updated=1",
    });
    mocks.saveQuickCaptureWithoutRedirect.mockResolvedValue({ captureId: "capture-1" });
    mocks.savePersonalMoment.mockResolvedValue({ id: "moment-1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reviews without storing anything or sending the contact directory to a model", async () => {
    const result = await previewHomeInput(base.text);
    expect(result.suggestedRelationshipId).toBe("tom");
    expect(result.interpretation.kind).toBe("conversation");
    const data = mocks.interpretConversationalCapture.mock.calls[0][0];
    expect(data.personLabel).toBe("No existing person selected");
    expect(data.text).toBe(base.text);
    expect(mocks.savePersonalMoment).not.toHaveBeenCalled();
    expect(mocks.saveReviewedPersonCapture).not.toHaveBeenCalled();
  });

  it("requires an existing person to store a conversation without raw persistence", async () => {
    await expect(saveHomeInput({ ...base, relationshipId: "" })).rejects.toThrow("existing person");
    expect(mocks.saveQuickCaptureWithoutRedirect).not.toHaveBeenCalled();
    const result = await saveHomeInput(base);
    expect(result).toEqual({ saved: true, destination: "/relationships/tom?updated=1" });
    expect(mocks.saveReviewedPersonCapture).toHaveBeenCalledWith("tom", {
      text: base.text, kind: "conversation", source: "meeting", interactionDate: "2026-11-23",
    });
  });

  it("protects original notes against obvious copied transcripts", async () => {
    await expect(saveHomeInput({ ...base, kind: "note", relationshipId: "" }))
      .rejects.toThrow("pasted conversation");
    await expect(saveHomeInput({ ...base, kind: "moment" }))
      .rejects.toThrow("pasted conversation");
    expect(mocks.saveQuickCaptureWithoutRedirect).not.toHaveBeenCalled();
    expect(mocks.savePersonalMoment).not.toHaveBeenCalled();
  });

  it("lets an authored note use the cautious existing global capture path", async () => {
    const result = await saveHomeInput({ ...base, kind: "note",
      text: "I met a new neighbor today.", relationshipId: "" });
    expect(result.destination).toBe("/captures/capture-1");
    expect(mocks.saveQuickCaptureWithoutRedirect).toHaveBeenCalledOnce();
  });

  it("saves a moment private by default and without a person", async () => {
    const result = await saveHomeInput({ ...base, kind: "moment",
      text: "A thought about a film I disliked.", relationshipId: "" });
    expect(result).toEqual({ saved: true, destination: "/moments?saved=moment-1" });
    expect(mocks.savePersonalMoment).toHaveBeenCalledWith({
      description: "A thought about a film I disliked.", consideration: "private",
    });
  });

  it("rejects ambiguous classification or content exceeding safe size", async () => {
    await expect(saveHomeInput({ ...base, kind: "uncertain" as "note" })).rejects.toThrow("Choose what kind");
    await expect(saveHomeInput({ ...base, text: "x".repeat(80_001) })).rejects.toThrow();
    expect(mocks.saveReviewedPersonCapture).not.toHaveBeenCalled();
  });
});
