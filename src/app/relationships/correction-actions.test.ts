import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  correctSavedActionableMemory: vi.fn(),
  dismissSavedConnectionSuggestion: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/relationship-store", () => ({
  correctSavedActionableMemory: mocks.correctSavedActionableMemory,
  dismissSavedConnectionSuggestion: mocks.dismissSavedConnectionSuggestion,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { correctRelationshipActionableMemory, dismissRelationshipConnectionIdea } from "./correction-actions";

describe("memory-correction server actions", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("persists a user-selected done disposition against the exact original memory", async () => {
    const target = { kind: "open-loop" as const, commitment: "Send a link to Judy.", owner: "Jason" };
    const data = new FormData();
    data.set("decision", "Done");
    await correctRelationshipActionableMemory("judy", target, data);
    expect(mocks.correctSavedActionableMemory).toHaveBeenCalledWith(
      "judy", target, "Done", { text: "", context: "" },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/relationships/judy");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("does not let the user mark another person's promise as done", async () => {
    const data = new FormData();
    data.set("decision", "Done");
    await expect(correctRelationshipActionableMemory("judy", {
      kind: "open-loop", commitment: "Judy might run a 5K.", owner: "Judy",
    }, data)).rejects.toThrow(/Only a commitment you made/);
    expect(mocks.correctSavedActionableMemory).not.toHaveBeenCalled();
  });

  it("passes user corrections with explicit text and context", async () => {
    const data = new FormData();
    data.set("decision", "Edit");
    data.set("replacementText", "Ask Judy whether she'd like a running group link.");
    data.set("replacementContext", "Jason");
    await correctRelationshipActionableMemory("judy", {
      kind: "open-loop", commitment: "Send Judy a 5K schedule.", owner: "Jason",
    }, data);
    expect(mocks.correctSavedActionableMemory.mock.calls[0][3]).toEqual({
      text: "Ask Judy whether she'd like a running group link.", context: "Jason",
    });
  });

  it("does not save invalid dispositions or an Edit lacking replacement input", async () => {
    const target = { kind: "opportunity" as const, id: "future:1" };
    const data = new FormData();
    data.set("decision", "Ignore all");
    await expect(correctRelationshipActionableMemory("judy", target, data)).rejects.toThrow(/Choose/);
    data.set("decision", "Edit");
    await expect(correctRelationshipActionableMemory("judy", target, data)).rejects.toThrow(/corrected/);
    expect(mocks.correctSavedActionableMemory).not.toHaveBeenCalled();
  });

  it("rejects all corrections outside of local development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const data = new FormData();
    data.set("decision", "Incorrect");
    await expect(correctRelationshipActionableMemory("judy", {
      kind: "opportunity", id: "future:1",
    }, data)).rejects.toThrow(/development/);
    expect(mocks.correctSavedActionableMemory).not.toHaveBeenCalled();
  });

  it("dismisses a generated suggestion without changing underlying relationship facts", async () => {
    expect(await dismissRelationshipConnectionIdea("judy", "fact:abc")).toEqual({
      dismissed: true,
    });
    expect(mocks.dismissSavedConnectionSuggestion).toHaveBeenCalledWith(
      "judy", "fact:abc", "Jason",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });
});
