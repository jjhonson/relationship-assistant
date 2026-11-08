"use server";

import { cookies } from "next/headers";
import {
  gmailSelectionToCorrespondence,
  normalizeEmailAddress,
  selectPilotThreads,
  type AliasCandidate,
  type PilotAnalysisDisclosure,
  type ThreadCandidate,
} from "@/lib/real-contact-pilot";
import {
  prepareRealPilotConsent,
  readRealPilotConsent,
} from "@/lib/real-contact-consent";
import { inferRelationshipFromCorrespondence } from "@/lib/openai-inference";
import type { RelationshipInference } from "@/lib/inference-benchmark";
import { loadConfig } from "@/lib/gmail/config";
import { fetchApprovedPilotContent, PilotContentError } from "@/lib/gmail/pilot-content";
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

export type PilotConsentResult =
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      token: string;
      expiresAt: number;
      disclosure: PilotAnalysisDisclosure;
    };

export type PilotEvidenceSummary = {
  id: string;
  source: string;
  conversationId: string;
  date: string;
  from: string;
  to: string;
  subject: string;
};

export type PilotAnalysisResult =
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      personLabel: string;
      inference: RelationshipInference;
      evidence: PilotEvidenceSummary[];
      model: string;
      usage: {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
      };
      messageCount: number;
      totalCharacters: number;
    };

type ActiveSession = {
  accessToken: string;
  sessionSecret: string;
};

async function activeSession(): Promise<ActiveSession | null> {
  const cfg = loadConfig();
  if (!cfg.ok) return null;
  const store = await cookies();
  const creds = readCreds(store.get(CRED_COOKIE)?.value, cfg.config.sessionSecret);
  if (!creds || creds.expiresAt - 60_000 < Date.now()) return null;
  return {
    accessToken: creds.accessToken,
    sessionSecret: cfg.config.sessionSecret,
  };
}

function metadataError(error: unknown): string {
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
    const session = await activeSession();
    if (!session) {
      return { kind: "error", message: "Gmail is not connected or the session expired. Reconnect Gmail and try again." };
    }

    const [owner, found] = await Promise.all([
      fetchOwnerAddress(session.accessToken),
      fetchPilotAliasMetadata(session.accessToken, label),
    ]);
    return {
      kind: "ready",
      personLabel: label,
      candidates: aliasCandidatesFromMetadata(found.messages, label, owner ? [owner] : []),
      truncated: found.truncated,
    };
  } catch (error) {
    return { kind: "error", message: metadataError(error) };
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

    const session = await activeSession();
    if (!session) {
      return { kind: "error", message: "Gmail is not connected or the session expired. Reconnect Gmail and try again." };
    }

    const found = await fetchPilotThreadMetadata(session.accessToken, confirmedAliases);
    return {
      kind: "ready",
      personLabel: label,
      confirmedAliases,
      candidates: threadCandidatesFromMetadata(found.messages, confirmedAliases),
      truncated: found.truncated,
    };
  } catch (error) {
    return { kind: "error", message: metadataError(error) };
  }
}

export async function preparePilotAnalysis(
  personLabel: string,
  aliases: string[],
  selectedThreadIds: string[],
): Promise<PilotConsentResult> {
  if (process.env.NODE_ENV !== "development") {
    return { kind: "error", message: "The real-contact pilot is only available in local development." };
  }

  try {
    const label = normalizePilotPersonLabel(personLabel);
    const confirmedAliases = [...new Set(aliases.map(normalizeEmailAddress).filter(Boolean))];
    if (confirmedAliases.length === 0 || confirmedAliases.length > MAX_PILOT_ALIASES) {
      return { kind: "error", message: `Confirm between 1 and ${MAX_PILOT_ALIASES} email addresses.` };
    }

    const session = await activeSession();
    if (!session) {
      return { kind: "error", message: "Gmail is not connected or the session expired. Reconnect Gmail and try again." };
    }

    // Gmail-specific validation happens here. Everything above this point remains metadata-only.
    const found = await fetchPilotThreadMetadata(session.accessToken, confirmedAliases);
    const candidates = threadCandidatesFromMetadata(found.messages, confirmedAliases);
    const gmailSelection = selectPilotThreads(
      { personLabel: label, confirmedAliases },
      candidates,
      selectedThreadIds,
    );
    const selection = gmailSelectionToCorrespondence(gmailSelection);
    const prepared = prepareRealPilotConsent(selection, {
      sessionSecret: session.sessionSecret,
      connectionBinding: session.accessToken,
    });

    return {
      kind: "ready",
      token: prepared.token,
      expiresAt: prepared.expiresAt,
      disclosure: prepared.disclosure,
    };
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith("Select ") ||
      error.message.includes("reviewed candidate list") ||
      error.message.includes("confirmed identity")
    )) {
      return { kind: "error", message: error.message };
    }
    return { kind: "error", message: metadataError(error) };
  }
}

export async function analyzePilotConsent(token: string): Promise<PilotAnalysisResult> {
  if (process.env.NODE_ENV !== "development") {
    return { kind: "error", message: "The real-contact pilot is only available in local development." };
  }

  try {
    const session = await activeSession();
    if (!session) {
      return { kind: "error", message: "Gmail is not connected or the session expired. Reconnect Gmail and try again." };
    }

    const selection = readRealPilotConsent(token, {
      sessionSecret: session.sessionSecret,
      connectionBinding: session.accessToken,
    });

    const content = await fetchApprovedPilotContent(session.accessToken, selection);
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) {
      return { kind: "error", message: "OpenAI is not configured for this local pilot." };
    }

    const result = await inferRelationshipFromCorrespondence({
      id: "real-contact-pilot",
      title: `Real-contact pilot: ${selection.personLabel}`,
      asOfDate: new Date().toISOString().slice(0, 10),
      messages: content.messages,
    }, {
      apiKey,
      model: process.env.OPENAI_RELATIONSHIP_MODEL,
    });

    return {
      kind: "ready",
      personLabel: selection.personLabel,
      inference: result.inference,
      evidence: content.messages.map(({ id, source, conversationId, date, from, to, subject }) => ({
        id,
        source,
        conversationId,
        date,
        from,
        to,
        subject,
      })),
      model: result.model,
      usage: result.usage,
      messageCount: content.messageCount,
      totalCharacters: content.totalCharacters,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { kind: "error", message: "Your Gmail session expired or was revoked. Reconnect Gmail and try again." };
    }
    if (error instanceof PilotContentError) {
      return { kind: "error", message: error.message };
    }
    if (error instanceof Error && (
      error.message.startsWith("Analysis approval") ||
      error.message.includes("different source connection")
    )) {
      return { kind: "error", message: error.message };
    }
    return {
      kind: "error",
      message: "Relationship analysis failed safely. No result was saved.",
    };
  }
}
