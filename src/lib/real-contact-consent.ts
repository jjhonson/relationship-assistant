import { createHash } from "node:crypto";
import { seal, unseal } from "./gmail/crypto";
import {
  MAX_REAL_PILOT_THREADS,
  buildPilotAnalysisDisclosure,
  type PilotAnalysisDisclosure,
  type PilotThreadSelection,
} from "./real-contact-pilot";

const CONSENT_VERSION = 1;
export const REAL_PILOT_CONSENT_TTL_MS = 10 * 60 * 1000;

type ConsentPayload = {
  version: 1;
  personLabel: string;
  confirmedAliases: string[];
  selectedThreadIds: string[];
  connectionFingerprint: string;
  issuedAt: number;
  expiresAt: number;
};

export type PreparedRealPilotConsent = {
  token: string;
  expiresAt: number;
  disclosure: PilotAnalysisDisclosure;
};

function connectionFingerprint(accessToken: string) {
  return createHash("sha256").update(accessToken).digest("base64url").slice(0, 24);
}

function validStringArray(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

export function prepareRealPilotConsent(
  selection: PilotThreadSelection,
  options: {
    sessionSecret: string;
    accessToken: string;
    now?: number;
  },
): PreparedRealPilotConsent {
  const now = options.now ?? Date.now();
  const uniqueThreadIds = [...new Set(selection.selectedThreadIds)];
  const uniqueAliases = [...new Set(selection.confirmedAliases.map((item) => item.trim().toLowerCase()))];

  if (uniqueThreadIds.length === 0 || uniqueThreadIds.length > MAX_REAL_PILOT_THREADS) {
    throw new Error(`Consent requires between 1 and ${MAX_REAL_PILOT_THREADS} selected threads.`);
  }
  if (uniqueAliases.length === 0) {
    throw new Error("Consent requires at least one confirmed email address.");
  }

  const normalizedSelection: PilotThreadSelection = {
    personLabel: selection.personLabel.trim(),
    confirmedAliases: uniqueAliases,
    selectedThreadIds: uniqueThreadIds,
  };
  if (!normalizedSelection.personLabel) throw new Error("Consent requires a person label.");

  const payload: ConsentPayload = {
    version: CONSENT_VERSION,
    ...normalizedSelection,
    connectionFingerprint: connectionFingerprint(options.accessToken),
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
    accessToken: string;
    now?: number;
  },
): PilotThreadSelection {
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
    typeof value.personLabel !== "string" ||
    !validStringArray(value.confirmedAliases, 5) ||
    !validStringArray(value.selectedThreadIds, MAX_REAL_PILOT_THREADS) ||
    typeof value.connectionFingerprint !== "string" ||
    typeof value.issuedAt !== "number" ||
    typeof value.expiresAt !== "number"
  ) {
    throw new Error("Analysis approval is malformed.");
  }

  if (value.expiresAt <= now || value.issuedAt > now + 60_000) {
    throw new Error("Analysis approval expired. Review the selected threads again.");
  }

  if (value.connectionFingerprint !== connectionFingerprint(options.accessToken)) {
    throw new Error("Analysis approval belongs to a different Gmail connection.");
  }

  return {
    personLabel: value.personLabel,
    confirmedAliases: [...new Set(value.confirmedAliases.map((item) => item.trim().toLowerCase()))],
    selectedThreadIds: [...new Set(value.selectedThreadIds)],
  };
}
