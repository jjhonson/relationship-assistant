import { createHash } from "node:crypto";
import type { CorrespondenceSelection, CorrespondenceSource } from "./correspondence";
import { seal, unseal } from "./gmail/crypto";
import {
  MAX_REAL_PILOT_CONVERSATIONS,
  buildPilotAnalysisDisclosure,
  type PilotAnalysisDisclosure,
} from "./real-contact-pilot";

const CONSENT_VERSION = 2;
export const REAL_PILOT_CONSENT_TTL_MS = 10 * 60 * 1000;

type ConsentPayload = {
  version: 2;
  source: CorrespondenceSource;
  personLabel: string;
  confirmedIdentityKeys: string[];
  selectedConversationIds: string[];
  connectionFingerprint: string;
  issuedAt: number;
  expiresAt: number;
};

export type PreparedRealPilotConsent = {
  token: string;
  expiresAt: number;
  disclosure: PilotAnalysisDisclosure;
};

function connectionFingerprint(connectionBinding: string) {
  return createHash("sha256").update(connectionBinding).digest("base64url").slice(0, 24);
}

function validStringArray(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

function validSource(value: unknown): value is CorrespondenceSource {
  return ["gmail", "linkedin", "sms", "whatsapp", "slack", "meeting", "fixture"].includes(
    String(value),
  );
}

export function prepareRealPilotConsent(
  selection: CorrespondenceSelection,
  options: {
    sessionSecret: string;
    connectionBinding: string;
    now?: number;
  },
): PreparedRealPilotConsent {
  const now = options.now ?? Date.now();
  const selectedConversationIds = [...new Set(selection.selectedConversationIds)];
  const confirmedIdentityKeys = [
    ...new Set(selection.confirmedIdentityKeys.map((item) => item.trim()).filter(Boolean)),
  ];

  if (
    selectedConversationIds.length === 0 ||
    selectedConversationIds.length > MAX_REAL_PILOT_CONVERSATIONS
  ) {
    throw new Error(
      \`Consent requires between 1 and \${MAX_REAL_PILOT_CONVERSATIONS} selected conversations.\`,
    );
  }
  if (confirmedIdentityKeys.length === 0) {
    throw new Error("Consent requires at least one confirmed identity.");
  }

  const normalizedSelection: CorrespondenceSelection = {
    source: selection.source,
    personLabel: selection.personLabel.trim(),
    confirmedIdentityKeys,
    selectedConversationIds,
  };
  if (!normalizedSelection.personLabel) throw new Error("Consent requires a person label.");

  const payload: ConsentPayload = {
    version: CONSENT_VERSION,
    ...normalizedSelection,
    connectionFingerprint: connectionFingerprint(options.connectionBinding),
    issuedAt: now,
    expiresAt: now + REAL_PILOT_CONSENT_TTL_MS,
  };

  return {
    token: seal(JSON.stringify(payload), options.sessionSecret),
    expiresAt: payload.expiresAt,
    disclosure: buildPilotAnalysisDisclosure(normalizedSelection),
  };
}

export function readRealPilotConsent(
  token: string,
  options: {
    sessionSecret: string;
    connectionBinding: string;
    now?: number;
  },
): CorrespondenceSelection {
  const raw = unseal(token, options.sessionSecret);
  if (!raw) throw new Error("Analysis approval is invalid or was altered.");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("Analysis approval could not be read.");
  }

  if (!payload || typeof payload !== "object") throw new Error("Analysis approval is malformed.");
  const value = payload as Partial<ConsentPayload>;
  const now = options.now ?? Date.now();

  if (
    value.version !== CONSENT_VERSION ||
    !validSource(value.source) ||
    typeof value.personLabel !== "string" ||
    !validStringArray(value.confirmedIdentityKeys, 10) ||
    !validStringArray(value.selectedConversationIds, MAX_REAL_PILOT_CONVERSATIONS) ||
    typeof value.connectionFingerprint !== "string" ||
    typeof value.issuedAt !== "number" ||
    typeof value.expiresAt !== "number"
  ) {
    throw new Error("Analysis approval is malformed.");
  }

  if (value.expiresAt <= now || value.issuedAt > now + 60_000) {
    throw new Error("Analysis approval expired. Review the selected conversations again.");
  }

  if (value.connectionFingerprint !== connectionFingerprint(options.connectionBinding)) {
    throw new Error("Analysis approval belongs to a different source connection.");
  }

  return {
    source: value.source,
    personLabel: value.personLabel,
    confirmedIdentityKeys: [
      ...new Set(value.confirmedIdentityKeys.map((item) => item.trim()).filter(Boolean)),
    ],
    selectedConversationIds: [...new Set(value.selectedConversationIds)],
  };
}
