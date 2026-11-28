import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  origin: vi.fn(), session: vi.fn(), records: vi.fn(), refresh: vi.fn(),
  owner: vi.fn(), lookup: vi.fn(), assess: vi.fn(), retrieve: vi.fn(), process: vi.fn(),
  prepare: vi.fn(), consume: vi.fn(), cancel: vi.fn(), cancelPerson: vi.fn(), revalidatePath: vi.fn(),
  aliases: vi.fn(), aliasCandidates: vi.fn(), conflicts: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: mocks.origin }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/relationship-store", () => ({ listRelationships: mocks.records, inspectPersonGmailBatch: mocks.assess }));
vi.mock("@/lib/gmail/personal-connection", () => ({ personalGmailSessionContext: mocks.session, freshPersonalGmailAccess: mocks.refresh }));
vi.mock("@/lib/gmail/messages", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gmail/messages")>(), fetchOwnerAddress: mocks.owner,
}));
vi.mock("@/lib/gmail/pilot-metadata", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gmail/pilot-metadata")>(),
  fetchPilotAliasMetadata: mocks.aliases, aliasCandidatesFromMetadata: mocks.aliasCandidates,
}));
vi.mock("@/lib/gmail/person-import", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gmail/person-import")>(), lookupPersonImportPlan: mocks.lookup,
}));
vi.mock("@/lib/gmail/person-import-memory", () => ({ hasPersonImportAddressConflict: mocks.conflicts }));
vi.mock("@/lib/gmail/person-import-content", () => ({ retrievePersonImportContent: mocks.retrieve }));
vi.mock("@/lib/gmail/person-import-processing", () => ({ analyzeAndSavePersonGmailMessage: mocks.process }));
vi.mock("@/lib/gmail/person-import-consent", () => ({ personGmailApprovals: {
  prepare: mocks.prepare, consume: mocks.consume, cancel: mocks.cancel, cancelPerson: mocks.cancelPerson,
} }));

import { findPersonGmailAddresses, preparePersonGmailReview, importPersonGmailReview } from "./actions";
import { afterEach } from "vitest";

const scope = { personId: "alex", mailboxAddress: "owner@example.test", confirmedAddresses: ["alex@example.test"] };
const candidate = { providerKey: "gmail:owner@example.test:message", messageId: "message", threadId: "thread",
  observedAt: "2026-11-20T15:00:00.000Z", direction: "received" as const, contactAddress: "alex@example.test" };
const token = "x".repeat(43);
const connected = { profileBinding: "profile", session: { id: "session" } };
describe("person-scoped Gmail action boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("RA_PERSONAL_GMAIL_MODEL_APPROVED", "yes");
    vi.stubEnv("OPENAI_API_KEY", "fixture");
    vi.stubEnv("OPENAI_RELATIONSHIP_MODEL", "fixture-model");
    mocks.origin.mockReturnValue("http://localhost:3001");
    mocks.session.mockResolvedValue(connected);
    mocks.records.mockResolvedValue([{ id: "alex", personLabel: "Alex", sources: [] }]);
    mocks.refresh.mockResolvedValue("fixture-access");
    mocks.owner.mockResolvedValue(scope.mailboxAddress);
    mocks.conflicts.mockReturnValue(false);
    mocks.lookup.mockResolvedValue({ scope, candidates: [candidate], scannedCount: 1, excludedCount: 0,
      previouslyImportedCount: 0, moreAvailable: false });
    mocks.assess.mockResolvedValue([{ candidate, kind: "ready", personLabel: "Alex" }]);
    mocks.prepare.mockReturnValue({ token, expiresAt: 1000 });
    mocks.consume.mockReturnValue({ scope, candidates: [candidate] });
    mocks.retrieve.mockResolvedValue({ messages: [{ ...candidate, body: "Fixture", subject: "Fixture" }], skipped: [] });
    mocks.process.mockResolvedValue({ kind: "saved", deferredFactCount: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires identity/header permission before any Gmail access and blocks wrong origin or cross-person address", async () => {
    expect((await preparePersonGmailReview("alex", ["alex@example.test"], false)).kind).toBe("error");
    expect((await findPersonGmailAddresses("alex", false)).kind).toBe("error");
    mocks.origin.mockReturnValueOnce("https://other.invalid");
    expect((await preparePersonGmailReview("alex", ["alex@example.test"], true)).kind).toBe("error");
    mocks.conflicts.mockReturnValueOnce(true);
    expect((await preparePersonGmailReview("alex", ["alex@example.test"], true)).kind).toBe("error");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.aliases).not.toHaveBeenCalled();
  });

  it("reviews only metadata and never sends provider IDs, bodies or model credentials to the browser", async () => {
    const result = await preparePersonGmailReview("alex", ["alex@example.test"], true);
    expect(result).toMatchObject({ kind: "review", review: { token, messages: [{ day: "2026-11-20", direction: "received" }] } });
    expect(mocks.prepare).toHaveBeenCalledWith({ scope, candidates: [candidate] },
      { profileBinding: "profile", sessionId: "session", personId: "alex", personLabel: "Alex" });
    expect(JSON.stringify(result)).not.toContain(candidate.providerKey);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("blocks absent approvals, disabled model activation and invalid review before provider access", async () => {
    expect((await importPersonGmailReview("alex", token, false, true)).kind).toBe("error");
    expect((await importPersonGmailReview("alex", token, true, false)).kind).toBe("error");
    vi.stubEnv("RA_PERSONAL_GMAIL_MODEL_APPROVED", "");
    expect((await importPersonGmailReview("alex", token, true, true)).kind).toBe("error");
    vi.stubEnv("RA_PERSONAL_GMAIL_MODEL_APPROVED", "yes");
    mocks.consume.mockImplementationOnce(() => { throw new Error("wrong session"); });
    expect((await importPersonGmailReview("alex", token, true, true)).kind).toBe("error");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("retrieves only the reviewed server-side selection and reports structured outcomes", async () => {
    const result = await importPersonGmailReview("alex", token, true, true);
    expect(mocks.retrieve).toHaveBeenCalledWith("fixture-access", scope, [candidate]);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ kind: "complete", saved: 1, deferredFacts: 1, unconfirmed: 0 });
    expect(JSON.stringify(result)).not.toContain("Fixture");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/relationships/alex");
  });
  it("skips changed/overlapping selection before reading bodies, and reports uncertain saves honestly", async () => {
    mocks.assess.mockResolvedValueOnce([{ candidate, kind: "needs-review", reason: "possible-manual-overlap" }]);
    expect(await importPersonGmailReview("alex", token, true, true)).toMatchObject({ kind: "complete", saved: 0, reviewNeeded: 1 });
    expect(mocks.retrieve).not.toHaveBeenCalled();
    mocks.process.mockRejectedValueOnce(new Error("unknown save response"));
    expect(await importPersonGmailReview("alex", token, true, true)).toMatchObject({ kind: "complete", saved: 0, unconfirmed: 1 });
  });
});
