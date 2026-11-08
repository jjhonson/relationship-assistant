import { describe, expect, it } from "vitest";
import {
  prepareRealPilotConsent,
  readRealPilotConsent,
  REAL_PILOT_CONSENT_TTL_MS,
} from "./real-contact-consent";

const secret = "x".repeat(32);
const connectionBinding = "source-connection-a";

const selection = {
  source: "gmail" as const,
  personLabel: "Kate",
  confirmedIdentityKeys: ["Kate@Example.test", "kate@old.example.test"],
  selectedConversationIds: ["thread-1", "thread-2"],
};

describe("real-contact consent", () => {
  it("binds approval to source, identities, conversations, expiry, and source connection", () => {
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: secret,
      connectionBinding,
      now: 1_000,
    });

    expect(prepared.disclosure).toEqual({
      source: "gmail",
      personLabel: "Kate",
      confirmedIdentityKeys: ["kate@example.test", "kate@old.example.test"],
      selectedConversationIds: ["thread-1", "thread-2"],
      fieldsToRead: ["sender/recipient", "date", "subject/context", "message content"],
      attachmentsIncluded: false,
      provider: "OpenAI",
      providerStorageRequested: false,
    });
    expect(prepared.expiresAt).toBe(1_000 + REAL_PILOT_CONSENT_TTL_MS);

    expect(
      readRealPilotConsent(prepared.token, {
        sessionSecret: secret,
        connectionBinding,
        now: 2_000,
      }),
    ).toEqual({
      source: "gmail",
      personLabel: "Kate",
      confirmedIdentityKeys: ["kate@example.test", "kate@old.example.test"],
      selectedConversationIds: ["thread-1", "thread-2"],
    });
  });

  it("rejects tampering", () => {
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: secret,
      connectionBinding,
      now: 1_000,
    });

    expect(() =>
      readRealPilotConsent(prepared.token + "x", {
        sessionSecret: secret,
        connectionBinding,
        now: 2_000,
      }),
    ).toThrow("invalid or was altered");
  });

  it("rejects expiry", () => {
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: secret,
      connectionBinding,
      now: 1_000,
    });

    expect(() =>
      readRealPilotConsent(prepared.token, {
        sessionSecret: secret,
        connectionBinding,
        now: 1_000 + REAL_PILOT_CONSENT_TTL_MS,
      }),
    ).toThrow("expired");
  });

  it("rejects a different source connection", () => {
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: secret,
      connectionBinding,
      now: 1_000,
    });

    expect(() =>
      readRealPilotConsent(prepared.token, {
        sessionSecret: secret,
        connectionBinding: "source-connection-b",
        now: 2_000,
      }),
    ).toThrow("different source connection");
  });

  it("rejects more than three selected conversations", () => {
    expect(() =>
      prepareRealPilotConsent(
        {
          ...selection,
          selectedConversationIds: ["a", "b", "c", "d"],
        },
        {
          sessionSecret: secret,
          connectionBinding,
          now: 1_000,
        },
      ),
    ).toThrow("between 1 and 3");
  });
});
