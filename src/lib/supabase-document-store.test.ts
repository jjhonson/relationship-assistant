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
