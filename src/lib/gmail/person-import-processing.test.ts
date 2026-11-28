import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectPersonGmailMemory, savePersonGmailMemory } from "../relationship-store";
import { analyzeAndSavePersonGmailMessage } from "./person-import-processing";
import type { PersonImportMessage } from "./person-import-content";

vi.mock("../relationship-store", () => ({
  inspectPersonGmailMemory: vi.fn(),
  savePersonGmailMemory: vi.fn(),
}));
const scope = { personId: "person-fixture", mailboxAddress: "owner@example.test", confirmedAddresses: ["alex@example.test"] };
const message: PersonImportMessage = {
  providerKey: "gmail:owner@example.test:fixture", messageId: "fixture", threadId: "thread",
  observedAt: "2026-11-20T15:00:00.000Z", direction: "sent", contactAddress: "alex@example.test",
  subject: "Follow up", body: "I enjoyed hearing that you joined Fictional Software.", quotedHistoryRemoved: false,
};
describe("internal authorized Gmail processing sequence", () => {
  beforeEach(() => vi.resetAllMocks());
  it("skips duplicate or ambiguous memory before processing any content", async () => {
    const fetchImpl = vi.fn();
    vi.mocked(inspectPersonGmailMemory).mockResolvedValueOnce({ kind: "duplicate", relationshipId: scope.personId });
    expect(await analyzeAndSavePersonGmailMessage(scope, message, { apiKey: "fixture", fetchImpl }))
      .toEqual({ kind: "duplicate", relationshipId: scope.personId });
    vi.mocked(inspectPersonGmailMemory).mockResolvedValueOnce({
      kind: "needs-review", relationshipId: scope.personId, reason: "possible-manual-overlap",
    });
    expect(await analyzeAndSavePersonGmailMessage(scope, message, { apiKey: "fixture", fetchImpl }))
      .toMatchObject({ kind: "needs-review", reason: "possible-manual-overlap" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(savePersonGmailMemory).not.toHaveBeenCalled();
  });
  it("only sends structured input to the atomic save and reports its final conflict result", async () => {
    vi.mocked(inspectPersonGmailMemory).mockResolvedValue({ kind: "ready", personLabel: "Fictional Alex" });
    vi.mocked(savePersonGmailMemory).mockResolvedValue({
      kind: "needs-review", relationshipId: scope.personId, reason: "identity-conflict",
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({ observations: [
        { category: "Work", label: "Company", value: "Fictional Software", evidence: "you joined Fictional Software" },
      ] }) }] }],
    })));
    expect(await analyzeAndSavePersonGmailMessage(scope, message, { apiKey: "fixture", fetchImpl }))
      .toMatchObject({ kind: "needs-review", reason: "identity-conflict" });
    expect(savePersonGmailMemory).toHaveBeenCalledTimes(1);
    const savedInput = vi.mocked(savePersonGmailMemory).mock.calls[0][0];
    expect(savedInput.extraction.durableFacts[0].value).toBe("Fictional Software");
    expect(JSON.stringify(savedInput)).not.toContain(message.body);
    expect(JSON.stringify(savedInput)).not.toContain("you joined Fictional Software");
  });
  it("never invokes storage when the model fails", async () => {
    vi.mocked(inspectPersonGmailMemory).mockResolvedValue({ kind: "ready", personLabel: "Fictional Alex" });
    const fetchImpl = vi.fn(async () => new Response("provider unavailable", { status: 503 }));
    await expect(analyzeAndSavePersonGmailMessage(scope, message, { apiKey: "fixture", fetchImpl })).rejects.toThrow("503");
    expect(savePersonGmailMemory).not.toHaveBeenCalled();
  });
});
