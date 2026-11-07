"use server";

import { cookies } from "next/headers";
import { normalizeEmailAddress, type AliasCandidate, type ThreadCandidate } from "@/lib/real-contact-pilot";
import { loadConfig } from "@/lib/gmail/config";
import { fetchOwnerAddress } from "@/lib/gmail/messages";
import {
  MAX_PILOT_ALIASES,
  aliasCandidatesFromMetadata,
  fetchPilotAliasMetadata,
  fetchPilotThreadMetadata,
  normalizePilotPersonLabel,
  PilotMetadataError,
  threadCandidatesFromMetadata,
} from "@/lib/gmail/pilot-metadata";
import { AuthError } from "@/lib/gmail/oauth";
import { CRED_COOKIE, readCreds } from "@/lib/gmail/session";

export type PilotAliasLookupResult =
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      personLabel: string;
      candidates: AliasCandidate[];
      truncated: boolean;
    };

export type PilotThreadLookupResult =
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      personLabel: string;
      confirmedAliases: string[];
      candidates: ThreadCandidate[];
      truncated: boolean;
    };

async function accessToken(): Promise<string | null> {
  const cfg = loadConfig();
  if (!cfg.ok) return null;
  const store = await cookies();
  const creds = readCreds(store.get(CRED_COOKIE)?.value, cfg.config.sessionSecret);
  if (!creds || creds.expiresAt - 60_000 < Date.now()) return null;
  return creds.accessToken;
}

function safeError(error: unknown): string {
  if (error instanceof AuthError) {
    return "Your Gmail session expired or was revoked. Reconnect Gmail and try again.";
  }
  if (error instanceof PilotMetadataError) {
    if (
      error.message.startsWith("Enter a person's name") ||
      error.message.startsWith("Confirm between") ||
      error.message.startsWith("One of the confirmed")
    ) {
      return error.message;
    }
  }
  return "Gmail metadata could not be read right now. No message bodies were requested.";
}

export async function lookupPilotAliases(personLabel: string): Promise<PilotAliasLookupResult> {
  if (process.env.NODE_ENV !== "development") {
    return { kind: "error", message: "The real-contact pilot is only available in local development." };
  }

  try {
    const label = normalizePilotPersonLabel(personLabel);
    const token = await accessToken();
    if (!token) {
      return { kind: "error", message: "Gmail is not connected or the session expired. Reconnect Gmail and try again." };
    }

    const [owner, found] = await Promise.all([
      fetchOwnerAddress(token),
      fetchPilotAliasMetadata(token, label),
    ]);
    return {
      kind: "ready",
      personLabel: label,
      candidates: aliasCandidatesFromMetadata(found.messages, label, owner ? [owner] : []),
      truncated: found.truncated,
    };
  } catch (error) {
    return { kind: "error", message: safeError(error) };
  }
}

export async function lookupPilotThreads(
  personLabel: string,
  aliases: string[],
): Promise<PilotThreadLookupResult> {
  if (process.env.NODE_ENV !== "development") {
    return { kind: "error", message: "The real-contact pilot is only available in local development." };
  }

  try {
    const label = normalizePilotPersonLabel(personLabel);
    const confirmedAliases = [...new Set(aliases.map(normalizeEmailAddress).filter(Boolean))];
    if (confirmedAliases.length === 0 || confirmedAliases.length > MAX_PILOT_ALIASES) {
      return {
        kind: "error",
        message: `Confirm between 1 and ${MAX_PILOT_ALIASES} email addresses.`,
      };
    }

    const token = await accessToken();
    if (!token) {
      return { kind: "error", message: "Gmail is not connected or the session expired. Reconnect Gmail and try again." };
    }

    const found = await fetchPilotThreadMetadata(token, confirmedAliases);
    return {
      kind: "ready",
      personLabel: label,
      confirmedAliases,
      candidates: threadCandidatesFromMetadata(found.messages, confirmedAliases),
      truncated: found.truncated,
    };
  } catch (error) {
    return { kind: "error", message: safeError(error) };
  }
}
