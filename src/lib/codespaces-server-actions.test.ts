import { describe, expect, it } from "vitest";
import { codespaceServerActionOrigins } from "../../next.config";

describe("Codespaces Server Actions origin allowlist", () => {
  it("trusts only the current Codespace development host and localhost", () => {
    const origins = codespaceServerActionOrigins({
      NODE_ENV: "development",
      CODESPACE_NAME: "unhallowed-spell-q744p45v99734pgg",
    });
    expect(origins).toEqual([
      "unhallowed-spell-q744p45v99734pgg-3000.app.github.dev",
      "localhost:3000",
    ]);
    expect(origins).not.toContain("*.app.github.dev");
  });

  it("does not add a Codespaces allowlist in production or on ordinary local machines", () => {
    expect(codespaceServerActionOrigins({
      NODE_ENV: "production", CODESPACE_NAME: "fictional-codespace",
    })).toEqual([]);
    expect(codespaceServerActionOrigins({ NODE_ENV: "development" })).toEqual([]);
  });

  it("rejects invalid/injected Codespace names", () => {
    for (const name of ["*.app.github.dev", "../other", "other.example.com", "a:3000"]) {
      expect(codespaceServerActionOrigins({
        NODE_ENV: "development", CODESPACE_NAME: name,
      })).toEqual([]);
    }
  });
});
