import { fetchOwnerAddress } from "./messages";
import {
  isPersonImportProviderId,
  normalizePersonImportScope,
  PERSON_IMPORT_MESSAGE_LIMIT,
  PersonImportError,
  planPersonImport,
  type PersonImportCandidate,
  type PersonImportScope,
} from "./person-import";
import {
  fetchIndividualGmailMessage,
  MAX_REAL_PILOT_MESSAGE_CHARS,
  MAX_REAL_PILOT_TOTAL_CHARS,
  type GmailMessage,
  type GmailPart,
} from "./pilot-content";
import type { PilotMetadataMessage } from "./pilot-metadata";

const MAX_ESTIMATED_MESSAGE_BYTES = 512 * 1024;

export type PersonImportMessage = PersonImportCandidate & {
  subject: string;
  /** Transient, untrusted evidence; do not persist the raw body. */
  body: string;
  quotedHistoryRemoved: boolean;
};

type SkipReason = "changed-metadata" | "size-limit" | "calendar-artifact" |
  "unsupported-content" | "empty-content" | "character-limit" | "batch-budget";

export type PersonImportContent = {
  scope: PersonImportScope;
  messages: PersonImportMessage[];
  skipped: { providerKey: string; reason: SkipReason }[];
  totalCharacters: number;
};

function sameCandidate(a: PersonImportCandidate, b: PersonImportCandidate): boolean {
  return a.providerKey === b.providerKey && a.messageId === b.messageId &&
    a.threadId === b.threadId && a.observedAt === b.observedAt &&
    a.direction === b.direction && a.contactAddress === b.contactAddress;
}

export function validatePersonImportSelection(scope: PersonImportScope, items: readonly PersonImportCandidate[]) {
  if (items.length === 0 || items.length > PERSON_IMPORT_MESSAGE_LIMIT) {
    throw new PersonImportError("A nonempty bounded selection of messages is required.");
  }
  const seen = new Set<string>();
  for (const item of items) {
    const time = Date.parse(item.observedAt);
    if (!isPersonImportProviderId(item.messageId) || !isPersonImportProviderId(item.threadId) ||
        item.providerKey !== "gmail:" + scope.mailboxAddress + ":" + item.messageId ||
        !Number.isFinite(time) || new Date(time).toISOString() !== item.observedAt ||
        !["sent", "received"].includes(item.direction) ||
        !scope.confirmedAddresses.includes(item.contactAddress) || seen.has(item.providerKey)) {
      throw new PersonImportError("Invalid or duplicate message in the approved selection.");
    }
    seen.add(item.providerKey);
  }
}

function metadataFor(message: GmailMessage): PilotMetadataMessage | null {
  if (!message.id || !Array.isArray(message.labelIds) ||
      message.labelIds.some((label) => typeof label !== "string") ||
      !Array.isArray(message.payload?.headers)) return null;
  const headers: { name: string; value: string }[] = [];
  for (const header of message.payload.headers) {
    if (typeof header.name !== "string" || typeof header.value !== "string") return null;
    headers.push({ name: header.name, value: header.value });
  }
  return {
    id: message.id, threadId: message.threadId, internalDate: message.internalDate,
    labelIds: message.labelIds, payload: { headers },
  };
}

function stillMatches(scope: PersonImportScope, expected: PersonImportCandidate, message: GmailMessage) {
  const metadata = metadataFor(message);
  if (!metadata) return false;
  const current = planPersonImport(scope, { messages: [metadata], truncated: false }).candidates[0];
  return Boolean(current && sameCandidate(expected, current));
}

function boundedSize(message: GmailMessage): boolean {
  return typeof message.sizeEstimate === "number" && Number.isSafeInteger(message.sizeEstimate) &&
    message.sizeEstimate > 0 && message.sizeEstimate <= MAX_ESTIMATED_MESSAGE_BYTES;
}

function mimeHeader(part: GmailPart, name: string): string {
  return (part.headers ?? []).filter((header) => header.name?.toLowerCase() === name)
    .map((header) => header.value ?? "").join("; ");
}

function containsCalendar(part: GmailPart | undefined): boolean {
  if (!part) return false;
  return /(?:text\/calendar|application\/ics)/i.test(part.mimeType ?? "") ||
    /\.ics$/i.test(part.filename ?? "") ||
    /text\/calendar/i.test(mimeHeader(part, "content-type")) ||
    (part.parts ?? []).some(containsCalendar);
}

/** Exactly one inline plain-text body. Never interpret an attachment or nested
 * forwarded message as if the correspondent authored it. Rich-text-only and
 * ambiguous MIME layouts are explicitly deferred, not silently discarded.
 */
function readPlainText(part: GmailPart | undefined): string | null {
  const bodies: string[] = [];
  function visit(current: GmailPart) {
    if (current.filename?.trim() || current.body?.attachmentId ||
        /\battachment\b/i.test(mimeHeader(current, "content-disposition"))) return;
    const mime = current.mimeType?.toLowerCase();
    if (mime === "multipart/mixed" || mime === "multipart/alternative" || mime === "multipart/related") {
      for (const child of current.parts ?? []) visit(child);
      return;
    }
    if (mime === "text/plain" && typeof current.body?.data === "string" &&
        /^[A-Za-z0-9_-]*={0,2}$/.test(current.body.data)) {
      bodies.push(Buffer.from(current.body.data, "base64url").toString("utf8"));
    }
  }
  if (part) visit(part);
  return bodies.length === 1 ? bodies[0] : null;
}

/** Conservative top-posted reply extraction. Quoting conventions vary: the
 * caller must not treat even this minimized body as proof of authorship of all
 * included statements. Stop on a recognizable quotation/forward boundary
 * instead of stitching text from opposite sides of the boundary together.
 */
export function minimizePersonImportText(raw: string): { body: string; quotedHistoryRemoved: boolean } {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  let quotedHistoryRemoved = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nearby = lines.slice(i, i + 4).map((item) => item.trim()).join(" ");
    const following = lines.slice(i + 1, i + 6).join("\n");
    if (/^>/.test(line) ||
        (/^On\s/i.test(line) && /^On\s.{3,500}\bwrote:\s/i.test(nearby + " ")) ||
        /^(?:[-_]{2,}\s*)?(?:Original Message|Forwarded message)\s*[-_:]*$/i.test(line) ||
        /^Begin forwarded message:$/i.test(line) ||
        (/^From:/i.test(line) && /^(?:Sent|Date|To|Subject):/im.test(following))) {
      quotedHistoryRemoved = true;
      break;
    }
    kept.push(lines[i]);
  }
  return { body: kept.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    quotedHistoryRemoved };
}

/**
 * Retrieve an already approved exact message selection, oldest first.
 * INTERNAL adapter only: the future server action must check the live personal
 * profile, person/alias ownership, session binding and explicit body/model
 * consent before calling. This function does not authorize access, invoke a
 * model, save anything, or retrieve entire threads.
 */
export async function retrievePersonImportContent(
  token: string,
  rawScope: PersonImportScope,
  approvedCandidates: readonly PersonImportCandidate[],
): Promise<PersonImportContent> {
  const scope = normalizePersonImportScope(rawScope);
  validatePersonImportSelection(scope, approvedCandidates);
  const actualMailbox = await fetchOwnerAddress(token);
  if (actualMailbox?.trim().toLowerCase() !== scope.mailboxAddress) {
    throw new PersonImportError("The connected Gmail mailbox does not match the approved scope.");
  }

  const selected = [...approvedCandidates].sort((a, b) =>
    a.observedAt.localeCompare(b.observedAt) || a.messageId.localeCompare(b.messageId));
  const messages: PersonImportMessage[] = [];
  const skipped: PersonImportContent["skipped"] = [];
  const skip = (item: PersonImportCandidate, reason: SkipReason) =>
    skipped.push({ providerKey: item.providerKey, reason });
  let totalCharacters = 0;

  for (const item of selected) {
    if (totalCharacters >= MAX_REAL_PILOT_TOTAL_CHARS) {
      skip(item, "batch-budget");
      continue;
    }
    // Revalidate each exact message with headers before retrieving any body.
    const metadata = await fetchIndividualGmailMessage(token, item.messageId, "metadata");
    if (!stillMatches(scope, item, metadata)) {
      skip(item, "changed-metadata");
      continue;
    }
    if (!boundedSize(metadata)) {
      skip(item, "size-limit");
      continue;
    }

    const full = await fetchIndividualGmailMessage(token, item.messageId, "full");
    if (!stillMatches(scope, item, full)) {
      skip(item, "changed-metadata");
      continue;
    }
    if (!boundedSize(full)) {
      skip(item, "size-limit");
      continue;
    }
    if (containsCalendar(full.payload)) {
      skip(item, "calendar-artifact");
      continue;
    }
    const raw = readPlainText(full.payload);
    if (raw === null) {
      skip(item, "unsupported-content");
      continue;
    }
    const { body, quotedHistoryRemoved } = minimizePersonImportText(raw);
    if (!body) {
      skip(item, "empty-content");
      continue;
    }
    const subject = mimeHeader(full.payload!, "subject").trim();
    if (body.length > MAX_REAL_PILOT_MESSAGE_CHARS || subject.length > 512) {
      skip(item, "character-limit");
      continue;
    }
    const characters = body.length + subject.length;
    if (totalCharacters + characters > MAX_REAL_PILOT_TOTAL_CHARS) {
      skip(item, "batch-budget");
      continue;
    }

    totalCharacters += characters;
    messages.push({ ...item, subject, body, quotedHistoryRemoved });
  }

  return { scope, messages, skipped, totalCharacters };
}
