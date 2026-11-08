import { describe, expect, it } from "vitest";
import {
  prepareRealPilotConsent,
  readRealPilotConsent,
  REAL_PILOT_CONSENT_TTL_MS,
} from "./real-contact-consent";

const secret = "x".repeat(32);
const accessToken = "gmail-access-token-a";

const selection = {
  personLabel: "Kate",
  confirmedAliases: ["Kate@Example.test", "kate@old.example.test"],
  selectedThreadIds: ["thread-1", "thread-2"],
};

describe("real-contact consent", () => {
  it("binds approval to person, aliases, threads, expiry, and Gmail connection", () => {
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: secret,
      accessToken,
      now: 1_000,
    });

    expect(prepared.disclosure).toEqual({
      personLabel: "Kate",
      confirmedAliases: ["kate@example.test", "kate@old.example.test"],
      selectedThreadIds: ["thread-1", "thread-2"],
      fieldsToRead: ["sender/recipient", "date", "subject", "plain-text message content"],
      attachmentsIncluded: false,
      provider: "OpenAI",
      providerStorageRequested: false,
    });
    expect(prepared.expiresAt).toBe(1_000 + REAL_PILOT_CONSENT_TTL_MS);

    expect(
      readRealPilotConsent(prepared.token, {
        sessionSecret: secret,
        accessToken,
        now: 2_000,
      }),
    ).toEqual({
      personLabel: "Kate",
      confirmedAliases: ["kate@example.test", "kate@old.example.test"],
      selectedThreadIds: ["thread-1", "thread-2"],
    });
  });

  it("rejects tampering", () => {
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: secret,
      accessToken,
      now: 1_000,
    });

    expect(() =>
      readRealPilotConsent(prepared.token + "x", {
        sessionSecret: secret,
        accessToken,
        now: 2_000,
      }),
    ).toThrow("invalid or was altered");
  });

  it("rejects expiry", () => {
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: secret,
      accessToken,
      now: 1_000,
    });

    expect(() =>
      readRealPilotConsent(prepared.token, {
        sessionSecret: secret,
        accessToken,
        now: 1_000 + REAL_PILOT_CONSENT_TTL_MS,
      }),
    ).toThrow("expired");
  });

  it("rejects a different Gmail connection", () => {
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: secret,
      accessToken,
      now: 1_000,
    });

    expect(() =>
      readRealPilotConsent(prepared.token, {
        sessionSecret: secret,
        accessToken: "gmail-access-token-b",
        now: 2_000,
      }),
    ).toThrow("different Gmail connection");
  });

  it("rejects more than three selected threads", () => {
    expect(() =>
      prepareRealPilotConsent(
        {
          ...selection,
          selectedThreadIds: ["a", "b", "c", "d"],
        },
        {
          sessionSecret: secret,
          accessToken,
          now: 1_000,
        },
      ),
    ).toThrow("between 1 and 3");
  });
});
