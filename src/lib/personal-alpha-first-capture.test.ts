import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitHomeText } from "../app/home/actions";
import { listRelationships } from "./relationship-store";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const owner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const text = "Fictional Morgan: I started a garden.\nMe: Tell me more.\n" +
  "Fictional Morgan: A long invented conversation about flowers.\nMe: Interesting.\n".repeat(600);
const extraction = {
  summary: "Fictional Morgan started a garden.", relationshipContexts: [], relationshipRoles: [], tags: [],
  durableFacts: [{ existingFactId: "", category: "Interest", label: "Gardening", value: "Started a garden." }],
  activeThreads: [], openLoops: [], stewardshipOpportunities: [], unknowns: [],
};
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const modelReply = (value: unknown) => reply({ output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
describe("first long pasted transcript through actual personal runtime Home action", () => {
  let revision: number;
  let document: Record<string, unknown>;
  let failExtraction: boolean;
  let extractCalls: number;
  beforeEach(() => {
    revision = 0; failExtraction = false; extractCalls = 0;
    document = { version: 1, relationships: [], captures: [], moments: [], connectionJourneys: [], raDatasetPurpose: "personal" };
    for (const [key,value] of Object.entries({
      NODE_ENV: "production", CODESPACES: "true", RA_DATASET_MODE: "personal",
      RA_STORAGE_BACKEND: "supabase", RA_PERSONAL_DATA_ENABLED: "yes",
      RA_DB_OWNER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", RA_PERSONAL_DB_OWNER_ID: owner,
      RA_PERSONAL_SUPABASE_URL: "https://fictional.supabase.co",
      RA_PERSONAL_SUPABASE_SECRET_KEY: "sb_secret_personal_fixture", OPENAI_API_KEY: "fictional_key",
    })) vi.stubEnv(key,value);
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      if (url.includes(".supabase.co/rest/v1/rpc/")) {
        expect(payload.p_owner_id).toBe(owner);
        if (url.endsWith("ra_store_read")) return reply({revision, document});
        if (url.endsWith("ra_store_write")) {
          expect(payload.p_expected_revision).toBe(revision);
          document = structuredClone(payload.p_document); return reply(++revision);
        }
      }
      if (url === "https://api.openai.com/v1/responses") {
        expect(payload.store).toBe(false);
        if (payload.text.format.name === "conversational_capture_preview")
          return modelReply({ kind: "conversation", source: "meeting", interactionDate: "", dateEvidence: "unknown",
            summary: "Fictional transcript", question: "When did you talk?" });
        if (payload.text.format.name === "relationship_interaction_extraction") {
          extractCalls++;
          expect(payload.input).toContain(text.trim());
          return failExtraction ? reply({}, 503) : modelReply(extraction);
        }
      }
      throw new Error("Unexpected fixture request");
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const choices = { relationshipId: "__new__", newPersonLabel: "Fictional Morgan", interactionDate: "2026-11-24" };
  it("asks only for missing identity/date and atomically saves a new person's structured memories", async () => {
    expect(text.length).toBeGreaterThan(40_000);
    expect(text.length).toBeLessThan(80_000);
    expect(await submitHomeText({ text, submissionId: requestId })).toMatchObject({ state: "clarify", field: "person" });
    expect(await submitHomeText({ text, submissionId: requestId,
      choices: { relationshipId: "__new__", newPersonLabel: "Fictional Morgan" } }))
      .toMatchObject({ state: "clarify", field: "date" });
    expect(revision).toBe(0);
    expect(await submitHomeText({ text, submissionId: requestId, choices })).toMatchObject({state: "saved"});
    const people = await listRelationships();
    expect(people).toHaveLength(1);
    expect(people[0].personLabel).toBe("Fictional Morgan");
    expect(people[0].lastInteractionAt).toBe("2026-11-24");
    expect(people[0].durableFacts[0].value).toBe("Started a garden.");
    expect(JSON.stringify(document)).not.toContain("A long invented conversation");
    expect(document.raDatasetPurpose).toBe("personal");
    expect(await submitHomeText({ text, submissionId: requestId, choices })).toMatchObject({state: "saved"});
    expect(await listRelationships()).toHaveLength(1);
    expect((await listRelationships())[0].sources.filter(s => s.id === "pasted:" + requestId)).toHaveLength(1);
    await expect(submitHomeText({ text, submissionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", choices }))
      .rejects.toThrow("already exists");
    expect(await listRelationships()).toHaveLength(1);
    expect(extractCalls).toBeGreaterThan(0);
  });
  it("does not create an empty person when extraction fails", async () => {
    failExtraction = true;
    await expect(submitHomeText({ text, submissionId: requestId, choices })).rejects.toThrow("status 503");
    expect(await listRelationships()).toHaveLength(0);
    expect(revision).toBe(0);
  });
  it("refuses a production environment without explicit private profile", async () => {
    vi.stubEnv("RA_DATASET_MODE", "fictional");
    const send = vi.mocked(fetch);
    await expect(submitHomeText({ text, submissionId: requestId, choices })).rejects.toThrow("private personal alpha");
    expect(send).not.toHaveBeenCalled();
    expect(revision).toBe(0);
  });
});
