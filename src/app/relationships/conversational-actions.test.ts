import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRelationship: vi.fn(),
  savePersonalMoment: vi.fn(),
  learnFromPastedConversation: vi.fn(),
  saveQuickCaptureWithoutRedirect: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/relationship-store", () => ({
  getRelationship: mocks.getRelationship, savePersonalMoment: mocks.savePersonalMoment,
}));
vi.mock("./actions", () => ({ learnFromPastedConversation: mocks.learnFromPastedConversation }));
vi.mock("./capture-actions", () => ({ saveQuickCaptureWithoutRedirect: mocks.saveQuickCaptureWithoutRedirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveReviewedPersonCapture } from "./conversational-actions";

describe("reviewed capture saves without nested redirect exceptions", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.clearAllMocks();
    mocks.getRelationship.mockResolvedValue({ id: "tom", personLabel: "Tom (fictional)" });
    mocks.learnFromPastedConversation.mockResolvedValue({ relationshipId: "tom" });
    mocks.saveQuickCaptureWithoutRedirect.mockResolvedValue({ captureId: "note-1" });
    mocks.savePersonalMoment.mockResolvedValue({ id: "moment-1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("confirms a pasted conversation write and returns its route, not a redirect error", async () => {
    const raw = "Tom: I'm practicing guitar.";
    const result = await saveReviewedPersonCapture("tom", {
      text: raw, kind: "conversation", source: "meeting", interactionDate: "2026-11-22",
    });
    expect(result).toEqual({ saved: true, destination: "/relationships/tom?updated=1" });
    expect(mocks.learnFromPastedConversation).toHaveBeenCalledOnce();
    const form = mocks.learnFromPastedConversation.mock.calls[0][1] as FormData;
    expect(form.get("transcript")).toBe(raw);
    expect(form.get("source")).toBe("meeting");
    expect(form.get("interactionDate")).toBe("2026-11-22");
    expect(mocks.savePersonalMoment).not.toHaveBeenCalled();
    expect(mocks.saveQuickCaptureWithoutRedirect).not.toHaveBeenCalled();
  });

  it("returns the saved authored note's destination without redirecting or double-saving", async () => {
    const result = await saveReviewedPersonCapture("tom", {
      text: "I met Tom outside.", kind: "note", source: "unspecified", interactionDate: "",
    });
    expect(result).toEqual({ saved: true, destination: "/captures/note-1" });
    const form = mocks.saveQuickCaptureWithoutRedirect.mock.calls[0][1] as FormData;
    expect(form.get("note")).toBe("I met Tom outside.");
    expect(mocks.learnFromPastedConversation).not.toHaveBeenCalled();
  });

  it("returns a successful private moment route after storage", async () => {
    const result = await saveReviewedPersonCapture("tom", {
      text: "A thought about learning music.", kind: "moment",
      source: "unspecified", interactionDate: "",
    });
    expect(result).toEqual({ saved: true, destination: "/moments?saved=moment-1" });
    expect(mocks.savePersonalMoment).toHaveBeenCalledWith({
      description: "A thought about learning music.", consideration: "private",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/moments");
  });

  it("never claims a failed write succeeded or falls back to another retention path", async () => {
    mocks.learnFromPastedConversation.mockRejectedValueOnce(new Error("fictional store failed"));
    await expect(saveReviewedPersonCapture("tom", {
      text: "Tom: Hello", kind: "conversation", source: "messages",
      interactionDate: "2026-11-22",
    })).rejects.toThrow("fictional store failed");
    expect(mocks.savePersonalMoment).not.toHaveBeenCalled();
    expect(mocks.saveQuickCaptureWithoutRedirect).not.toHaveBeenCalled();
  });


  it("blocks verbatim storage when a pasted transcript is misclassified as a personal note or moment", async () => {
    const pasted = "I just finished a call with Tom. Here's the transcript:\nTom: I'm gardening.\nMe: How's it going?";
    for (const kind of ["note", "moment"] as const) {
      await expect(saveReviewedPersonCapture("tom", {
        text: pasted, kind, source: "unspecified", interactionDate: "",
      })).rejects.toThrow("pasted conversation");
    }
    expect(mocks.saveQuickCaptureWithoutRedirect).not.toHaveBeenCalled();
    expect(mocks.savePersonalMoment).not.toHaveBeenCalled();
    expect(mocks.learnFromPastedConversation).not.toHaveBeenCalled();
  });

  it("rejects unreviewed/oversized input without writing", async () => {
    await expect(saveReviewedPersonCapture("tom", {
      text: "x".repeat(80_001), kind: "conversation",
      source: "meeting", interactionDate: "2026-11-22",
    })).rejects.toThrow();
    await expect(saveReviewedPersonCapture("tom", {
      text: "Unclear", kind: "uncertain" as "note",
      source: "unspecified", interactionDate: "",
    })).rejects.toThrow("Choose what kind");
    expect(mocks.learnFromPastedConversation).not.toHaveBeenCalled();
    expect(mocks.savePersonalMoment).not.toHaveBeenCalled();
  });
});
