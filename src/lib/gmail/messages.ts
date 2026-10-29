import {
  BROADER_EXPERIMENT_BATCH_WINDOWS,
  BROADER_EXPERIMENT_LIST_PAGES,
  BROADER_EXPERIMENT_MAX_ATTEMPTS_PER_BATCH,
  BROADER_EXPERIMENT_WINDOWS,
  MAX_EXPERIMENT_DETAIL_CAP,
  broaderExperimentQuota,
  type BroaderExperimentStats,
} from "./experiment";
import { enrichmentTargets } from "./discovery";
import { AuthError } from "./oauth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailSummary = {
  sampled: number;
  unread: number;
  oldest: string | null;
  newest: string | null;
  topSenderDomains: { domain: string; count: number }[];
};

type Meta = { labelIds?: string[]; payload?: { headers?: { name: string; value: string }[] } };

export type DiscoveryMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
};

export class ApiError extends Error {}

type RequestMeter = {
  attempts: number;
  maxAttempts: number;
  listAttempts: number;
  detailAttempts: number;
};

async function get<T>(path: string, token: string, meter?: RequestMeter): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (meter) {
      if (meter.attempts >= meter.maxAttempts) throw new ApiError("Gmail request budget reached");
      meter.attempts++;
      if (path.startsWith("/messages?")) meter.listAttempts++;
      else if (path.startsWith("/messages/")) meter.detailAttempts++;
    }
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        headers: { Authorization: ["Bearer", token].join(" ") },
        cache: "no-store",
      });
    } catch {
      if (!meter || attempt === 2) throw new ApiError("Gmail API request failed");
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    if (res.status === 401) throw new AuthError("Unauthorized");
    if (res.ok) return (await res.json()) as T;

    let rateLimited = res.status === 429;
    if (res.status === 403) {
      try {
        const body = (await res.json()) as {
          error?: { errors?: { reason?: string }[] };
        };
        rateLimited = body.error?.errors?.some((e) =>
          ["rateLimitExceeded", "userRateLimitExceeded"].includes(e.reason ?? ""),
        ) ?? false;
      } catch {}
    }
    const retryable = rateLimited || [500, 502, 503, 504].includes(res.status);
    if (!retryable || attempt === 2) throw new ApiError(`Gmail API returned ${res.status}`);

    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 2000)
      : 250 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new ApiError("Gmail API request failed");
}

/** Aggregates only; no subjects, addresses, snippets, or bodies are returned. */
export function summarize(items: Meta[]): GmailSummary {
  const header = (m: Meta, n: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
  const domains = new Map<string, number>();
  const dates: number[] = [];
  let unread = 0;
  for (const m of items) {
    if (m.labelIds?.includes("UNREAD")) unread++;
    const d = Date.parse(header(m, "date") ?? "");
    if (!Number.isNaN(d)) dates.push(d);
    const from = header(m, "from") ?? "";
    const addr = from.match(/@([^\s>@]+)>?\s*$/)?.[1]?.toLowerCase();
    if (addr) domains.set(addr, (domains.get(addr) ?? 0) + 1);
  }
  return {
    sampled: items.length,
    unread,
    oldest: dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : null,
    newest: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null,
    topSenderDomains: [...domains]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count })),
  };
}

export async function fetchSample(token: string, limit: number): Promise<GmailSummary> {
  const list = await get<{ messages?: { id: string }[] }>(`/messages?maxResults=${limit}`, token);
  const ids = (list.messages ?? []).slice(0, limit);
  const items = await Promise.all(
    ids.map((m) =>
      get<Meta>(
        `/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`,
        token,
      ),
    ),
  );
  return summarize(items);
}

const DISCOVERY_YEARS = 10;
const SENT_SHARE = 0.6;
const MAX_ENRICHED_CONTACTS = 20;
const ENRICHMENT_PER_CONTACT = 4;
const DETAIL_HEADERS = [
  "From",
  "To",
  "Cc",
  "Date",
  "List-Id",
  "List-Unsubscribe",
  "Precedence",
  "Auto-Submitted",
  "X-Auto-Response-Suppress",
];

/** Request counts only; never contains addresses. */
export type SamplingStats = {
  windowsQueried: number;
  /** Monthly breadth-pass windows queried (one message each, newest first). */
  monthWindowsQueried: number;
  sentBudget: number;
  enrichmentBudget: number;
  sentFetched: number;
  enrichedContacts: number;
  enrichmentFetched: number;
};

type Summary = { id: string; threadId?: string };

async function listIds(token: string, q: string, limit: number, meter?: RequestMeter): Promise<Summary[]> {
  const found: Summary[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({ maxResults: String(limit - found.length), q });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await get<{ messages?: Summary[]; nextPageToken?: string }>(`/messages?${params}`, token, meter);
    pages++;
    for (const message of page.messages ?? []) {
      if (!found.some((item) => item.id === message.id) && found.length < limit) found.push(message);
    }
    pageToken = page.nextPageToken;
  } while (pageToken && found.length < limit && pages < (meter ? BROADER_EXPERIMENT_LIST_PAGES : Infinity));
  return found;
}

async function fetchDetails(token: string, summaries: Summary[]): Promise<DiscoveryMessage[]> {
  const results: DiscoveryMessage[] = [];
  for (let start = 0; start < summaries.length; start += 5) {
    const fetched = await Promise.all(
      summaries.slice(start, start + 5).map(({ id, threadId }) => {
        const params = new URLSearchParams({
          format: "metadata",
          fields: "id,threadId,internalDate,labelIds,payload(headers)",
        });
        for (const header of DETAIL_HEADERS) params.append("metadataHeaders", header);
        return get<DiscoveryMessage>(`/messages/${encodeURIComponent(id)}?${params}`, token).then(
          (message) => ({ ...message, threadId: message.threadId ?? threadId }),
        );
      }),
    );
    results.push(...fetched);
  }
  return results;
}

type Window = { after: number; before: number };

/** Calendar windows (UTC epoch seconds), newest first, covering the last DISCOVERY_YEARS years. */
function calendarWindows(now: Date, perYear: number): Window[] {
  const months = 12 / perYear;
  const windows: Window[] = [];
  const current = Math.floor(now.getUTCMonth() / months);
  for (let i = 0; i < DISCOVERY_YEARS * perYear; i++) {
    const index = now.getUTCFullYear() * perYear + current - i;
    const year = Math.floor(index / perYear);
    const start = Date.UTC(year, (index % perYear) * months, 1);
    const end = Date.UTC(year, (index % perYear) * months + months, 1);
    windows.push({ after: start / 1000, before: Math.min(end, now.getTime() + 1000) / 1000 });
  }
  return windows;
}

const sentQuery = ({ after, before }: Window) => `in:sent -in:drafts after:${after} before:${before}`;

/**
 * Two-stage, bounded, metadata-only sampling (still biased and incomplete):
 *  1. Sent mail (`in:sent`) is sampled in two passes. A breadth pass takes the newest Sent
 *     message of each calendar month (so a correspondent who writes once a month is not
 *     crowded out by busy periods); a depth pass then spends any remaining budget on
 *     calendar quarters with an adaptive quota, so sparse periods donate budget to busy ones.
 *  2. For the top Sent-derived contacts, a bounded per-contact lookup fetches a few
 *     incoming messages to look for evidence of replies.
 * Total message detail fetches never exceed `limit` (max 200).
 */
export async function fetchDiscoverySample(
  token: string,
  limit: number,
  now = new Date(),
  ownerAddresses: string[] = [],
): Promise<{ messages: DiscoveryMessage[]; stats: SamplingStats }> {
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 200)) : 200;
  const sentBudget = cap >= 2 ? Math.max(1, Math.ceil(cap * SENT_SHARE)) : cap;
  let months = calendarWindows(now, 12);
  if (months.length > sentBudget) {
    const step = months.length / sentBudget;
    months = Array.from({ length: sentBudget }, (_, i) => months[Math.floor(i * step)]);
  }

  const sentSummaries: Summary[] = [];
  const seen = new Set<string>();
  const add = (ids: Summary[], maximumNew = Number.POSITIVE_INFINITY) => {
    let added = 0;
    for (const summary of ids) {
      if (!seen.has(summary.id) && sentSummaries.length < sentBudget && added < maximumNew) {
        seen.add(summary.id);
        sentSummaries.push(summary);
        added++;
      }
    }
  };
  for (let start = 0; start < months.length; start += 6) {
    const batch = await Promise.all(months.slice(start, start + 6).map((w) => listIds(token, sentQuery(w), 1)));
    batch.forEach(add);
  }

  const quarters = calendarWindows(now, 4);
  let quartersQueried = 0;
  for (let i = 0; i < quarters.length && sentSummaries.length < sentBudget; i++) {
    const quota = Math.ceil((sentBudget - sentSummaries.length) / (quarters.length - i));
    // The breadth pass may already hold up to three messages from this quarter; ask for extra to dedupe.
    add(await listIds(token, sentQuery(quarters[i]), quota + 3), quota);
    quartersQueried++;
  }
  const messages = await fetchDetails(token, sentSummaries);
  const stats: SamplingStats = {
    windowsQueried: months.length + quartersQueried,
    monthWindowsQueried: months.length,
    sentBudget,
    enrichmentBudget: cap - sentSummaries.length,
    sentFetched: messages.length,
    enrichedContacts: 0,
    enrichmentFetched: 0,
  };

  const budget = cap - messages.length;
  if (budget > 0) {
    const targets = enrichmentTargets(messages, Math.min(MAX_ENRICHED_CONTACTS, budget), ownerAddresses);
    const incoming: Summary[] = [];
    for (const address of targets) {
      const room = Math.min(ENRICHMENT_PER_CONTACT, budget - incoming.length);
      if (room <= 0) break;
      const ids = await listIds(token, `from:${address} -in:sent -in:drafts`, room);
      stats.enrichedContacts++;
      for (const summary of ids) {
        if (!seen.has(summary.id)) {
          seen.add(summary.id);
          incoming.push(summary);
        }
      }
    }
    const extra = await fetchDetails(token, incoming);
    stats.enrichmentFetched = extra.length;
    messages.push(...extra);
  }
  return { messages, stats };
}

type ExperimentWindow = { after: number; before: number };

function experimentWindows(anchor: number): ExperimentWindow[] {
  const date = new Date(anchor);
  return Array.from({ length: BROADER_EXPERIMENT_WINDOWS }, (_, index) => {
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - index + 1, 1);
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - index, 1);
    return {
      after: Math.floor(start / 1000),
      before: Math.floor(Math.min(end, anchor) / 1000),
    };
  });
}

async function mapBounded<T, R>(values: T[], concurrency: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await fn(values[index]);
    }
  }));
  return results;
}

/**
 * Fetches one bounded monthly batch for a local-only, opt-in coverage experiment.
 * The complete 10-year plan never requests more than `cap` unique message details.
 */
export async function fetchBroaderMetadataBatch(
  token: string,
  cap: number,
  startWindow: number,
  windowCount: number,
  anchor: number,
): Promise<{ messages: DiscoveryMessage[]; stats: BroaderExperimentStats }> {
  const boundedCap = Math.max(1, Math.min(Math.floor(cap), MAX_EXPERIMENT_DETAIL_CAP));
  if (!Number.isInteger(startWindow) || startWindow < 0 || startWindow >= BROADER_EXPERIMENT_WINDOWS ||
    !Number.isInteger(windowCount) || windowCount < 1 || windowCount > BROADER_EXPERIMENT_BATCH_WINDOWS ||
    startWindow + windowCount > BROADER_EXPERIMENT_WINDOWS ||
    !Number.isFinite(anchor) || anchor > Date.now() + 60_000 || anchor < Date.now() - 10 * 366 * 24 * 60 * 60 * 1000) {
    throw new ApiError("Invalid experiment batch");
  }

  const meter: RequestMeter = {
    attempts: 0,
    maxAttempts: BROADER_EXPERIMENT_MAX_ATTEMPTS_PER_BATCH,
    listAttempts: 0,
    detailAttempts: 0,
  };
  const windows = experimentWindows(anchor).slice(startWindow, startWindow + windowCount);
  const slots = windows.flatMap((window, offset) => {
    const windowIndex = startWindow + offset;
    return (["sent", "received"] as const).map((direction, directionIndex) => ({
      window,
      direction,
      quota: broaderExperimentQuota(boundedCap, windowIndex * 2 + directionIndex),
    }));
  }).filter((slot) => slot.quota > 0);

  let failedListBuckets = 0;
  const summaries = (await mapBounded(slots, 5, async (slot) => {
    const directionQuery = slot.direction === "sent" ? "in:sent" : "-in:sent";
    const query = `after:${slot.window.after} before:${slot.window.before} ${directionQuery} -in:drafts`;
    try {
      return await listIds(token, query, slot.quota, meter);
    } catch {
      failedListBuckets++;
      return [];
    }
  })).flat();

  const unique = new Map<string, Summary>();
  let duplicateIds = 0;
  for (const summary of summaries) {
    if (unique.has(summary.id)) duplicateIds++;
    else unique.set(summary.id, summary);
  }
  let failedDetails = 0;
  const details = await mapBounded<Summary, DiscoveryMessage | null>([...unique.values()], 5, async ({ id, threadId }) => {
    const params = new URLSearchParams({
      format: "metadata",
      fields: "id,threadId,internalDate,labelIds,payload(headers)",
    });
    for (const header of DETAIL_HEADERS) params.append("metadataHeaders", header);
    try {
      const message = await get<DiscoveryMessage>(`/messages/${encodeURIComponent(id)}?${params}`, token, meter);
      if (!message.threadId && threadId) return { ...message, threadId };
      return message;
    } catch {
      failedDetails++;
      return null;
    }
  });
  const messages = details.filter((message): message is DiscoveryMessage => message !== null);
  return {
    messages,
    stats: {
      windowsQueried: windowCount,
      listBucketsQueried: slots.length,
      plannedDetails: slots.reduce((total, slot) => total + slot.quota, 0),
      recordsFetched: messages.length,
      duplicateIds,
      failedListBuckets,
      failedDetails,
      apiRequests: meter.attempts,
      listRequests: meter.listAttempts,
      detailRequests: meter.detailAttempts,
    },
  };
}

export async function fetchHistoricalMessages(
  token: string,
  limit: number,
  now = new Date(),
): Promise<DiscoveryMessage[]> {
  return (await fetchDiscoverySample(token, limit, now)).messages;
}

/** The account owner's own address (Gmail profile; no mailbox content). Null if unavailable. */
export async function fetchOwnerAddress(token: string): Promise<string | null> {
  try {
    const profile = await get<{ emailAddress?: string }>("/profile", token);
    return profile.emailAddress?.toLowerCase() ?? null;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return null;
  }
}

export const LOOKUP_LIMIT = 10;
const LOOKUP_ADDRESS = /^[A-Z0-9._%+-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i;

export function isLookupAddress(value: string): boolean {
  return value.length <= 254 && LOOKUP_ADDRESS.test(value);
}

/**
 * Optional, user-triggered coverage check: one list request plus at most LOOKUP_LIMIT
 * metadata-header fetches. `truncated` means more results may exist. Verifies that Gmail
 * holds matching metadata, not relationship quality; an empty result is not proof of absence.
 */
export async function fetchAddressLookup(
  token: string,
  address: string,
): Promise<{ messages: DiscoveryMessage[]; truncated: boolean }> {
  if (!isLookupAddress(address)) throw new ApiError("Invalid address");
  const params = new URLSearchParams({
    maxResults: String(LOOKUP_LIMIT),
    q: `(from:${address} OR to:${address} OR cc:${address}) -in:drafts`,
  });
  const page = await get<{ messages?: Summary[]; nextPageToken?: string }>(`/messages?${params}`, token);
  const found = (page.messages ?? []).slice(0, LOOKUP_LIMIT);
  return {
    messages: await fetchDetails(token, found),
    truncated: Boolean(page.nextPageToken) || (page.messages ?? []).length > LOOKUP_LIMIT,
  };
}
