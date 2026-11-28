import { fetchOwnerAddress, isLookupAddress } from "./messages";
import {
  fetchPersonImportMetadata,
  isCalendarArtifactSubject,
  MAX_PILOT_ALIASES,
  PERSON_IMPORT_METADATA_LIMIT,
  type BoundedMetadataResult,
  type PilotMetadataMessage,
} from "./pilot-metadata";

export const PERSON_IMPORT_MESSAGE_LIMIT = 20;

export type PersonImportScope = {
  personId: string;
  /** The mailbox address verified using Gmail's profile endpoint. */
  mailboxAddress: string;
  /** Addresses explicitly confirmed as belonging to the selected person. */
  confirmedAddresses: string[];
};

export type PersonImportCandidate = {
  providerKey: string;
  messageId: string;
  threadId: string;
  observedAt: string;
  direction: "sent" | "received";
  contactAddress: string;
};

export type PersonImportPlan = {
  scope: PersonImportScope;
  /** A bounded metadata sample of apparent direct correspondence, not complete history. */
  coverage: "bounded-direct-only";
  scannedCount: number;
  excludedCount: number;
  previouslyImportedCount: number;
  moreAvailable: boolean;
  candidates: PersonImportCandidate[];
};

export class PersonImportError extends Error {}

function checkedScope(scope: PersonImportScope): PersonImportScope {
  const personId = scope.personId.trim();
  const mailboxAddress = scope.mailboxAddress.trim().toLowerCase();
  const confirmedAddresses = [...new Set(scope.confirmedAddresses.map(
    (address) => address.trim().toLowerCase(),
  ))].sort();
  if (!personId || personId.length > 128 || !isLookupAddress(mailboxAddress) ||
      confirmedAddresses.length === 0 || confirmedAddresses.length > MAX_PILOT_ALIASES ||
      confirmedAddresses.some((address) => !isLookupAddress(address) || address === mailboxAddress)) {
    throw new PersonImportError("A selected person, verified mailbox and confirmed distinct contact addresses are required.");
  }
  return { personId, mailboxAddress, confirmedAddresses };
}

function headerValues(message: PilotMetadataMessage, name: string): string[] {
  return (message.payload?.headers ?? [])
    .filter((header) => header.name.toLowerCase() === name.toLowerCase())
    .map((header) => header.value);
}

// Fail closed for groups, multiple mailboxes, ambiguous/malformed headers and
// unusual forms rather than dropping unparsed recipients. A received message's
// hidden recipients cannot be determined from the visible headers.
function singleAddress(values: string[]): string | null {
  if (values.length !== 1) return null;
  const value = values[0].trim();
  const named = value.match(/^(?:"(?:[^"\\\r\n]|\\.)*"|[^<>"@,;:\r\n]*)\s*<([^<>]+)>$/);
  const address = (named ? named[1] : value).trim().toLowerCase();
  return isLookupAddress(address) ? address : null;
}

function providerId(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function classify(
  scope: PersonImportScope,
  message: PilotMetadataMessage,
): PersonImportCandidate | null {
  if (!providerId(message.id) || !providerId(message.threadId)) return null;
  const labels = message.labelIds ?? [];
  if (["DRAFT", "TRASH", "SPAM"].some((label) => labels.includes(label))) return null;
  if (["Cc", "Bcc"].some((name) => headerValues(message, name).some((value) => value.trim()))) return null;

  const from = singleAddress(headerValues(message, "From"));
  const to = singleAddress(headerValues(message, "To"));
  if (!from || !to) return null;
  const sent = from === scope.mailboxAddress && scope.confirmedAddresses.includes(to) && labels.includes("SENT");
  const received = to === scope.mailboxAddress && scope.confirmedAddresses.includes(from) && !labels.includes("SENT");
  if (!sent && !received) return null;

  if (["List-Id", "List-Unsubscribe", "X-Auto-Response-Suppress"].some(
    (name) => headerValues(message, name).length > 0,
  ) || headerValues(message, "Precedence").some((value) => /\b(?:bulk|list|junk)\b/i.test(value)) ||
    headerValues(message, "Auto-Submitted").some((value) => value.trim().toLowerCase() !== "no") ||
    headerValues(message, "Subject").some(isCalendarArtifactSubject) ||
    headerValues(message, "Content-Type").some((value) => /text\/calendar/i.test(value))) return null;

  // Keep the provider's precise observation time. No import-time fallback, and
  // no conversion to a local day until the display/interaction layer.
  if (!message.internalDate || !/^\d+$/.test(message.internalDate)) return null;
  const time = Number(message.internalDate);
  if (!Number.isSafeInteger(time) || time <= 0 || time > 8_640_000_000_000_000) return null;
  return {
    providerKey: "gmail:" + scope.mailboxAddress + ":" + message.id,
    messageId: message.id,
    threadId: message.threadId,
    observedAt: new Date(time).toISOString(),
    direction: sent ? "sent" : "received",
    contactAddress: sent ? to : from,
  };
}

/** Pure planning: no body reads, model calls, record changes or claims of contact. */
export function planPersonImport(
  rawScope: PersonImportScope,
  metadata: BoundedMetadataResult,
  previouslyImportedKeys: readonly string[] = [],
): PersonImportPlan {
  const scope = checkedScope(rawScope);
  if (metadata.messages.length > PERSON_IMPORT_METADATA_LIMIT) {
    throw new PersonImportError("Metadata exceeds the bounded import limit.");
  }
  const byId = new Map<string, PersonImportCandidate | null>();
  let unidentifiedCount = 0;
  for (const message of metadata.messages) {
    if (!providerId(message.id)) {
      unidentifiedCount++;
      continue;
    }
    const candidate = classify(scope, message);
    if (!byId.has(message.id)) {
      byId.set(message.id, candidate);
    } else if (JSON.stringify(byId.get(message.id)) !== JSON.stringify(candidate)) {
      // Conflicting duplicate provider metadata must not be resolved by order.
      byId.set(message.id, null);
    }
  }

  const imported = new Set(previouslyImportedKeys);
  const eligible = [...byId.values()].filter((item): item is PersonImportCandidate => item !== null);
  const newCandidates = eligible.filter((item) => !imported.has(item.providerKey));
  const compare = (a: PersonImportCandidate, b: PersonImportCandidate) =>
    a.observedAt.localeCompare(b.observedAt) || a.messageId.localeCompare(b.messageId);
  const candidates = newCandidates.sort((a, b) => compare(b, a))
    .slice(0, PERSON_IMPORT_MESSAGE_LIMIT).sort(compare);

  return {
    scope,
    coverage: "bounded-direct-only",
    scannedCount: metadata.messages.length,
    excludedCount: unidentifiedCount + byId.size - eligible.length,
    previouslyImportedCount: eligible.length - newCandidates.length,
    moreAvailable: metadata.truncated || newCandidates.length > candidates.length,
    candidates,
  };
}

/**
 * Metadata-only acquisition for an already-consented, selected person. Not a
 * server action: future integration must validate person/alias ownership,
 * bind the connection to the personal profile and enforce consent before use.
 */
export async function lookupPersonImportPlan(
  token: string,
  rawScope: PersonImportScope,
  previouslyImportedKeys: readonly string[] = [],
): Promise<PersonImportPlan> {
  const scope = checkedScope(rawScope);
  const actualMailbox = await fetchOwnerAddress(token);
  if (actualMailbox?.trim().toLowerCase() !== scope.mailboxAddress) {
    throw new PersonImportError("The connected Gmail mailbox does not match the approved scope.");
  }
  const metadata = await fetchPersonImportMetadata(token, scope.confirmedAddresses);
  return planPersonImport(scope, metadata, previouslyImportedKeys);
}
