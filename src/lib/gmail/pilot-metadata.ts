import {
  normalizeEmailAddress,
  prepareAliasCandidates,
  type AliasCandidate,
  type ThreadCandidate,
} from "../real-contact-pilot";
import { isLookupAddress } from "./messages";
import { AuthError } from "./oauth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const PILOT_ALIAS_MESSAGE_LIMIT = 24;
export const PILOT_THREAD_MESSAGE_LIMIT = 60;
export const MAX_PILOT_ALIASES = 5;

const PERSON_LABEL = /^[\p{L}\p{N} .,'’()_-]+$/u;
const BARE_ADDRESS = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i;

export type PilotMetadataMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
};

export type BoundedMetadataResult = {
  messages: PilotMetadataMessage[];
  truncated: boolean;
};

export class PilotMetadataError extends Error {}

async function get<T>(path: string, token: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: ["Bearer", token].join(" ") },
      cache: "no-store",
    });
    if (res.status === 401) throw new AuthError("Unauthorized");
    if (res.ok) return (await res.json()) as T;

    let rateLimited = res.status === 429;
    if (res.status === 403) {
      try {
        const body = (await res.json()) as { error?: { errors?: { reason?: string }[] } };
        rateLimited = body.error?.errors?.some((item) =>
          ["rateLimitExceeded", "userRateLimitExceeded"].includes(item.reason ?? ""),
        ) ?? false;
      } catch {}
    }

    const retryable = rateLimited || [500, 502, 503, 504].includes(res.status);
    if (!retryable || attempt === 2) throw new PilotMetadataError(`Gmail API returned ${res.status}`);

    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 2000)
      : 250 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new PilotMetadataError("Gmail API request failed");
}

function header(message: PilotMetadataMessage, name: string): string {
  return message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
}

function splitMailboxes(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angle = false;
  let comment = 0;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quoted && char === "\\") {
      current += char + (value[i + 1] ?? "");
      i++;
      continue;
    }
    if (char === '"' && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment++;
    else if (!quoted && char === ")" && comment) comment--;
    else if (!quoted && !comment && char === "<") angle = true;
    else if (!quoted && !comment && char === ">") angle = false;

    if (char === "," && !quoted && !angle && !comment) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

type Mailbox = { address: string; name: string };

function parseMailboxes(value: string): Mailbox[] {
  const result: Mailbox[] = [];
  for (const part of splitMailboxes(value)) {
    const named = part.match(/^([\s\S]*)<([^<>]+)>\s*(?:\([^)]*\))?$/);
    const raw = (named ? named[2] : part.replace(/\([^)]*\)/g, "")).trim().toLowerCase();
    if (!BARE_ADDRESS.test(raw)) continue;

    const name = named
      ? named[1]
          .trim()
          .replace(/^"([\s\S]*)"$/, "$1")
          .replace(/\\(.)/g, "$1")
          .trim()
      : "";
    result.push({ address: raw, name });
  }
  return result;
}

function messageMailboxes(message: PilotMetadataMessage): Mailbox[] {
  const unique = new Map<string, Mailbox>();
  for (const name of ["From", "To", "Cc"]) {
    for (const mailbox of parseMailboxes(header(message, name))) {
      const current = unique.get(mailbox.address);
      if (!current || (!current.name && mailbox.name)) unique.set(mailbox.address, mailbox);
    }
  }
  return [...unique.values()];
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizePilotPersonLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80 || !PERSON_LABEL.test(label)) {
    throw new PilotMetadataError("Enter a person's name using ordinary letters, numbers, spaces, apostrophes or hyphens.");
  }
  return label;
}

function mailboxMatchesLabel(mailbox: Mailbox, label: string): boolean {
  const target = normalizeName(label);
  const display = normalizeName(mailbox.name);
  const local = normalizeName(mailbox.address.split("@", 1)[0] ?? "");
  return Boolean(target) && (display.includes(target) || local.includes(target));
}

async function fetchDetails(
  token: string,
  summaries: { id: string; threadId?: string }[],
  headers: string[],
): Promise<PilotMetadataMessage[]> {
  const result: PilotMetadataMessage[] = [];
  for (let start = 0; start < summaries.length; start += 5) {
    const batch = await Promise.all(
      summaries.slice(start, start + 5).map(({ id, threadId }) => {
        const params = new URLSearchParams({
          format: "metadata",
          fields: "id,threadId,internalDate,labelIds,payload(headers)",
        });
        for (const item of headers) params.append("metadataHeaders", item);
        return get<PilotMetadataMessage>(
          `/messages/${encodeURIComponent(id)}?${params}`,
          token,
        ).then((message) => ({ ...message, threadId: message.threadId ?? threadId }));
      }),
    );
    result.push(...batch);
  }
  return result;
}

async function boundedMetadataSearch(
  token: string,
  query: string,
  limit: number,
  headers: string[],
): Promise<BoundedMetadataResult> {
  const params = new URLSearchParams({
    maxResults: String(limit),
    q: query,
  });
  const page = await get<{
    messages?: { id: string; threadId?: string }[];
    nextPageToken?: string;
  }>(`/messages?${params}`, token);
  const found = (page.messages ?? []).slice(0, limit);
  return {
    messages: await fetchDetails(token, found, headers),
    truncated: Boolean(page.nextPageToken) || (page.messages ?? []).length > limit,
  };
}

export async function fetchPilotAliasMetadata(
  token: string,
  personLabel: string,
): Promise<BoundedMetadataResult> {
  const label = normalizePilotPersonLabel(personLabel);
  const query = `{from:"${label}" to:"${label}" cc:"${label}"} -in:drafts`;
  return boundedMetadataSearch(
    token,
    query,
    PILOT_ALIAS_MESSAGE_LIMIT,
    ["From", "To", "Cc", "Date"],
  );
}

export function aliasCandidatesFromMetadata(
  messages: PilotMetadataMessage[],
  personLabel: string,
  ownerAddresses: string[] = [],
): AliasCandidate[] {
  const label = normalizePilotPersonLabel(personLabel);
  const owners = new Set(ownerAddresses.map(normalizeEmailAddress));
  const counts = new Map<string, AliasCandidate>();

  for (const message of messages) {
    const matchedInMessage = new Map<string, Mailbox>();
    for (const mailbox of messageMailboxes(message)) {
      if (owners.has(mailbox.address) || !mailboxMatchesLabel(mailbox, label)) continue;
      matchedInMessage.set(mailbox.address, mailbox);
    }

    for (const mailbox of matchedInMessage.values()) {
      const current = counts.get(mailbox.address);
      counts.set(mailbox.address, {
        address: mailbox.address,
        displayName: current?.displayName || mailbox.name || undefined,
        observedMessageCount: (current?.observedMessageCount ?? 0) + 1,
      });
    }
  }

  return prepareAliasCandidates([...counts.values()]).sort(
    (a, b) =>
      b.observedMessageCount - a.observedMessageCount ||
      a.address.localeCompare(b.address),
  );
}

export async function fetchPilotThreadMetadata(
  token: string,
  aliases: string[],
): Promise<BoundedMetadataResult> {
  const normalized = [...new Set(aliases.map(normalizeEmailAddress).filter(Boolean))];
  if (normalized.length === 0 || normalized.length > MAX_PILOT_ALIASES) {
    throw new PilotMetadataError(`Confirm between 1 and ${MAX_PILOT_ALIASES} email addresses.`);
  }
  if (normalized.some((address) => !isLookupAddress(address))) {
    throw new PilotMetadataError("One of the confirmed email addresses is invalid.");
  }

  const clauses = normalized.flatMap((address) => [
    `from:${address}`,
    `to:${address}`,
    `cc:${address}`,
  ]);
  return boundedMetadataSearch(
    token,
    `{${clauses.join(" ")}} -in:drafts`,
    PILOT_THREAD_MESSAGE_LIMIT,
    ["From", "To", "Cc", "Date", "Subject"],
  );
}

function messageTimestamp(message: PilotMetadataMessage): number | null {
  if (message.internalDate) {
    const value = Number(message.internalDate);
    if (Number.isFinite(value)) return value;
  }
  const parsed = Date.parse(header(message, "Date"));
  return Number.isNaN(parsed) ? null : parsed;
}

export function threadCandidatesFromMetadata(
  messages: PilotMetadataMessage[],
  aliases: string[],
): ThreadCandidate[] {
  const confirmed = new Set(aliases.map(normalizeEmailAddress));
  const threads = new Map<
    string,
    {
      subject: string;
      first: number;
      last: number;
      messageCount: number;
      participantAddresses: Set<string>;
    }
  >();

  for (const message of messages) {
    const mailboxes = messageMailboxes(message);
    if (!mailboxes.some((mailbox) => confirmed.has(mailbox.address))) continue;

    const when = messageTimestamp(message);
    if (when === null) continue;
    const id = message.threadId || message.id;
    const subject = header(message, "Subject").trim() || "(no subject)";
    const current = threads.get(id) ?? {
      subject,
      first: when,
      last: when,
      messageCount: 0,
      participantAddresses: new Set<string>(),
    };

    current.first = Math.min(current.first, when);
    current.last = Math.max(current.last, when);
    current.messageCount++;
    if (current.subject === "(no subject)" && subject !== "(no subject)") current.subject = subject;
    for (const mailbox of mailboxes) current.participantAddresses.add(mailbox.address);
    threads.set(id, current);
  }

  return [...threads]
    .map(([id, value]) => ({
      id,
      subject: value.subject,
      firstDate: new Date(value.first).toISOString().slice(0, 10),
      lastDate: new Date(value.last).toISOString().slice(0, 10),
      messageCount: value.messageCount,
      participantAddresses: [...value.participantAddresses].sort(),
    }))
    .sort(
      (a, b) =>
        b.lastDate.localeCompare(a.lastDate) ||
        b.messageCount - a.messageCount ||
        a.id.localeCompare(b.id),
    );
}
