import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mutateSupabaseDocument, readSupabaseDocument, isSupabaseStorageEnabled,
} from "./supabase-document-store";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function configure() {
  vi.stubEnv("RA_STORAGE_BACKEND", "supabase");
  vi.stubEnv("RA_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("RA_SUPABASE_SECRET_KEY", "sb_secret_test_fixture");
  vi.stubEnv("RA_DB_OWNER_ID", owner);
}
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("server-only Supabase relationship document adapter", () => {
  it("defaults to the unchanged private JSON store unless explicitly enabled", () => {
    expect(isSupabaseStorageEnabled()).toBe(false);
    configure();
    expect(isSupabaseStorageEnabled()).toBe(true);
    vi.stubEnv("RA_STORAGE_BACKEND", "invalid");
    expect(() => isSupabaseStorageEnabled()).toThrow("Unsupported");
  });

  it("fails closed if enabled without server-only configuration", async () => {
    vi.stubEnv("RA_STORAGE_BACKEND", "supabase");
    vi.stubEnv("RA_SUPABASE_SECRET_KEY", "");
    vi.stubEnv("RA_SUPABASE_URL", "");
    vi.stubEnv("RA_DB_OWNER_ID", "");
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(readSupabaseDocument()).rejects.toThrow("not configured");
    expect(mock).not.toHaveBeenCalled();
  });


  it("accepts a URL-safe server secret containing hyphens", async () => {
    configure();
    vi.stubEnv("RA_SUPABASE_SECRET_KEY", "sb_secret_sample-secret_part-123");
    const mock = vi.fn().mockResolvedValue(reply(null));
    vi.stubGlobal("fetch", mock);
    await expect(readSupabaseDocument()).resolves.toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][1].headers.apikey).toBe("sb_secret_sample-secret_part-123");
  });

  it("rejects a publishable key before accessing any private records", async () => {
    configure();
    vi.stubEnv("RA_SUPABASE_SECRET_KEY", "sb_publishable_sample-key");
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(readSupabaseDocument()).rejects.toThrow("server-only Supabase secret key");
    expect(mock).not.toHaveBeenCalled();
  });

  it("reads through the named RPC with a backend-only API key", async () => {
    configure();
    const mock = vi.fn().mockResolvedValue(reply({ revision: 7, document: { version: 1, relationships: [] } }));
    vi.stubGlobal("fetch", mock);
    expect((await readSupabaseDocument())?.revision).toBe(7);
    const [url, options] = mock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/ra_store_read");
    expect(options.headers.apikey).toBe("sb_secret_test_fixture");
    expect(JSON.parse(options.body)).toEqual({ p_owner_id: owner });
  });

  it("replays a competing mutation against freshly read state", async () => {
    configure();
    const initial = { version: 1, relationships: [1] };
    const newer = { version: 1, relationships: [1, 2] };
    const mock = vi.fn()
      .mockResolvedValueOnce(reply({ revision: 0, document: initial }))
      .mockResolvedValueOnce(reply({ code: "40001" }, 409))
      .mockResolvedValueOnce(reply({ revision: 1, document: newer }))
      .mockResolvedValueOnce(reply(2));
    vi.stubGlobal("fetch", mock);
    const result = await mutateSupabaseDocument(
      (data) => structuredClone(data) as { version: number; relationships: number[] },
      (data) => { data.relationships.push(3); return data.relationships.length; },
    );
    expect(result).toBe(3);
    expect(mock).toHaveBeenCalledTimes(4);
    const first = JSON.parse(mock.mock.calls[1][1].body);
    const second = JSON.parse(mock.mock.calls[3][1].body);
    expect(first.p_expected_revision).toBe(0);
    expect(first.p_document.relationships).toEqual([1, 3]);
    expect(second.p_expected_revision).toBe(1);
    expect(second.p_document.relationships).toEqual([1, 2, 3]);
  });

  it("can initialize a never-before-written fictional namespace", async () => {
    configure();
    const mock = vi.fn()
      .mockResolvedValueOnce(reply(null))
      .mockResolvedValueOnce(reply(0));
    vi.stubGlobal("fetch", mock);
    const changed = await mutateSupabaseDocument(
      (data) => (data ?? { version: 1, relationships: [] }) as { version: 1; relationships: string[] },
      (data) => { data.relationships.push("fictional"); return true; },
    );
    expect(changed).toBe(true);
    expect(JSON.parse(mock.mock.calls[1][1].body).p_expected_revision).toBe(-1);
  });

  it("never silently writes to local JSON if the remote database fails", async () => {
    configure();
    const mock = vi.fn()
      .mockResolvedValueOnce(reply({ revision: 0, document: { version: 1, relationships: [] } }))
      .mockResolvedValueOnce(reply({ code: "permission_denied" }, 403));
    vi.stubGlobal("fetch", mock);
    await expect(mutateSupabaseDocument(
      (data) => structuredClone(data) as { version: number; relationships: unknown[] },
      (data) => { data.relationships.push("fictional"); return 1; },
    )).rejects.toThrow("Nothing was saved");
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

const personalOwner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function configurePersonal() {
  configure();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RA_DATASET_MODE", "personal");
  vi.stubEnv("RA_PERSONAL_DATA_ENABLED", "yes");
  vi.stubEnv("RA_PERSONAL_SUPABASE_URL", "https://fictional.supabase.co");
  vi.stubEnv("RA_PERSONAL_SUPABASE_SECRET_KEY", "sb_secret_personal_fixture");
  vi.stubEnv("RA_PERSONAL_DB_OWNER_ID", personalOwner);
}
describe("guarded personal and fictional profiles", () => {
  it("requires explicit activation and never permits personal data in the dev runtime", async () => {
    configurePersonal();
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    vi.stubEnv("RA_PERSONAL_DATA_ENABLED", "");
    await expect(readSupabaseDocument()).rejects.toThrow("explicit private activation");
    vi.stubEnv("RA_PERSONAL_DATA_ENABLED", "yes");
    vi.stubEnv("NODE_ENV", "development");
    await expect(readSupabaseDocument()).rejects.toThrow("reviewed production runtime");
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects a shared owner or live test endpoint before any request", async () => {
    configurePersonal();
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    vi.stubEnv("RA_PERSONAL_DB_OWNER_ID", owner.toUpperCase());
    await expect(readSupabaseDocument()).rejects.toThrow("distinct identifiers");
    vi.stubEnv("RA_PERSONAL_DB_OWNER_ID", personalOwner);
    vi.stubEnv("RA_PERSONAL_SUPABASE_URL", "https://not-a-fixture.supabase.co");
    await expect(readSupabaseDocument()).rejects.toThrow("Automated tests cannot access");
    expect(send).not.toHaveBeenCalled();
  });
  it("fictional mode cannot read or mutate a marked personal snapshot", async () => {
    configure();
    const send = vi.fn().mockImplementation(() => Promise.resolve(reply({
      revision: 2, document: { version: 1, relationships: [], raDatasetPurpose: "personal" },
    })));
    vi.stubGlobal("fetch", send);
    await expect(readSupabaseDocument()).rejects.toThrow("different or unverified mode");
    const mutate = vi.fn();
    await expect(mutateSupabaseDocument(x => x, mutate)).rejects.toThrow("different or unverified mode");
    expect(mutate).not.toHaveBeenCalled();
    expect(send.mock.calls.every(call => call[0].endsWith("/ra_store_read"))).toBe(true);
  });
  it("personal mode refuses an existing unmarked dataset instead of relabeling it", async () => {
    configurePersonal();
    const send = vi.fn().mockResolvedValue(reply({ revision: 3, document: { version: 1, relationships: [] } }));
    vi.stubGlobal("fetch", send);
    const mutate = vi.fn();
    await expect(mutateSupabaseDocument(x => x, mutate)).rejects.toThrow("different or unverified mode");
    expect(mutate).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("personal mode selects separate credentials and marks a new empty namespace", async () => {
    configurePersonal();
    const send = vi.fn().mockResolvedValueOnce(reply(null)).mockResolvedValueOnce(reply(0));
    vi.stubGlobal("fetch", send);
    await mutateSupabaseDocument(x => x ?? { version: 1, relationships: [] }, () => true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toContain("fictional.supabase.co");
    for (const [, options] of send.mock.calls) {
      expect(options.headers.apikey).toBe("sb_secret_personal_fixture");
      expect(JSON.parse(options.body).p_owner_id).toBe(personalOwner);
    }
    expect(JSON.parse(send.mock.calls[1][1].body).p_document.raDatasetPurpose).toBe("personal");
  });
  it("preserves the personal marker and never writes if it is removed", async () => {
    configurePersonal();
    const snapshot = { version: 1, relationships: [], raDatasetPurpose: "personal" };
    const send = vi.fn().mockResolvedValueOnce(reply({ revision: 2, document: snapshot })).mockResolvedValueOnce(reply(3));
    vi.stubGlobal("fetch", send);
    await mutateSupabaseDocument(x => x as typeof snapshot, d => d.relationships.length);
    expect(JSON.parse(send.mock.calls[1][1].body).p_document.raDatasetPurpose).toBe("personal");
    send.mockReset().mockResolvedValueOnce(reply({ revision: 3, document: snapshot }));
    await expect(mutateSupabaseDocument(x => x as Record<string, unknown>, d => { delete d.raDatasetPurpose; }))
      .rejects.toThrow("different or unverified mode");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
