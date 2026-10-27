import { describe, expect, it } from "vitest";
import { clampSampleSize, loadConfig } from "./config";
import { seal, unseal } from "./crypto";
import { summarize } from "./messages";
import { buildAuthUrl } from "./oauth";
import { readCreds, sealCreds } from "./session";

const secret = "x".repeat(32);
const env = {
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "sec",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/gmail/callback",
  SESSION_SECRET: secret,
};

describe("config", () => {
  it("clamps sample size to 1..50", () => {
    expect(clampSampleSize("500")).toBe(50);
    expect(clampSampleSize("5")).toBe(5);
    expect(clampSampleSize("abc")).toBe(50);
    expect(clampSampleSize(undefined)).toBe(50);
  });
  it("reports missing variables by name only", () => {
    const r = loadConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("GOOGLE_CLIENT_ID");
    expect(loadConfig(env).ok).toBe(true);
  });
});

describe("crypto/session", () => {
  it("round-trips and rejects tampering or wrong secret", () => {
    const s = seal("hello", secret);
    expect(s).not.toContain("hello");
    expect(unseal(s, secret)).toBe("hello");
    expect(unseal(s, "y".repeat(32))).toBeNull();
    expect(unseal(s.slice(0, -2) + "AA", secret)).toBeNull();
  });
  it("reads sealed credentials", () => {
    const c = { accessToken: "a", refreshToken: "r", expiresAt: 1 };
    expect(readCreds(sealCreds(c, secret), secret)).toEqual(c);
    expect(readCreds("garbage", secret)).toBeNull();
    expect(readCreds(undefined, secret)).toBeNull();
  });
});

describe("oauth", () => {
  it("requests only gmail.readonly with state and PKCE", () => {
    const r = loadConfig(env);
    if (!r.ok) throw new Error("config");
    const u = new URL(buildAuthUrl(r.config, "st", "ver"));
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(env.GOOGLE_REDIRECT_URI);
    expect(u.toString()).not.toContain("sec");
  });
});

describe("summarize", () => {
  it("returns aggregates only", () => {
    const h = (from: string, date: string) => ({
      payload: { headers: [{ name: "From", value: from }, { name: "Date", value: date }] },
    });
    const s = summarize([
      { labelIds: ["UNREAD"], ...h("A <a@x.com>", "Mon, 01 Jan 2024 10:00:00 +0000") },
      h("b@x.com", "Tue, 02 Jan 2024 10:00:00 +0000"),
      h("c@y.org", "bad"),
    ]);
    expect(s).toEqual({
      sampled: 3,
      unread: 1,
      oldest: "2024-01-01",
      newest: "2024-01-02",
      topSenderDomains: [{ domain: "x.com", count: 2 }, { domain: "y.org", count: 1 }],
    });
    expect(summarize([]).oldest).toBeNull();
  });
});
