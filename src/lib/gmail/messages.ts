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
const WINDOWS_PER_YEAR = 4;
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
  sentFetched: number;
  enrichedContacts: number;
  enrichmentFetched: number;
};

type Summary = { id: string; threadId?: string };

async function listIds(token: string, q: string, limit: number): Promise<Summary[]> {
  const found: Summary[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: String(limit - found.length), q });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await get<{ messages?: Summary[]; nextPageToken?: string }>(`/messages?${params}`, token);
    found.push(...(page.messages ?? []).slice(0, limit - found.length));
    pageToken = page.nextPageToken;
  } while (pageToken && found.length < limit);
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

/** Quarter windows (UTC epoch seconds), newest first, covering the last DISCOVERY_YEARS years. */
function quarterWindows(now: Date): { after: number; before: number }[] {
  const windows: { after: number; before: number }[] = [];
  const quarter = Math.floor(now.getUTCMonth() / 3);
  for (let i = 0; i < DISCOVERY_YEARS * WINDOWS_PER_YEAR; i++) {
    const index = now.getUTCFullYear() * 4 + quarter - i;
    const year = Math.floor(index / 4);
    const start = Date.UTC(year, (index % 4) * 3, 1);
    const end = Date.UTC(year, (index % 4) * 3 + 3, 1);
    windows.push({ after: start / 1000, before: Math.min(end, now.getTime() + 1000) / 1000 });
  }
  return windows;
}

/**
 * Two-stage, bounded, metadata-only sampling (still biased and incomplete):
 *  1. Sent mail (`in:sent`) is sampled per calendar quarter with an adaptive quota so
 *     sparse quarters donate unused budget to older ones, instead of taking the newest N per year.
 *  2. For the top Sent-derived contacts, a bounded per-contact lookup fetches a few
 *     incoming messages to look for evidence of replies.
 * Total message detail fetches never exceed `limit` (max 200).
 */
export async function fetchDiscoverySample(
  token: string,
  limit: number,
  now = new Date(),
): Promise<{ messages: DiscoveryMessage[]; stats: SamplingStats }> {
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 200)) : 200;
  const sentBudget = cap >= 2 ? Math.max(1, Math.ceil(cap * SENT_SHARE)) : cap;
  let windows = quarterWindows(now);
  if (windows.length > sentBudget) {
    const step = windows.length / sentBudget;
    windows = Array.from({ length: sentBudget }, (_, i) => windows[Math.floor(i * step)]);
  }

  const sentSummaries: Summary[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < windows.length && sentSummaries.length < sentBudget; i++) {
    const quota = Math.ceil((sentBudget - sentSummaries.length) / (windows.length - i));
    const { after, before } = windows[i];
    const ids = await listIds(token, `in:sent -in:drafts after:${after} before:${before}`, quota);
    for (const summary of ids) {
      if (!seen.has(summary.id)) {
        seen.add(summary.id);
        sentSummaries.push(summary);
      }
    }
  }
  const messages = await fetchDetails(token, sentSummaries);
  const stats: SamplingStats = {
    windowsQueried: windows.length,
    sentFetched: messages.length,
    enrichedContacts: 0,
    enrichmentFetched: 0,
  };

  const budget = cap - messages.length;
  if (budget > 0) {
    const targets = enrichmentTargets(messages, Math.min(MAX_ENRICHED_CONTACTS, budget));
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

export async function fetchHistoricalMessages(
  token: string,
  limit: number,
  now = new Date(),
): Promise<DiscoveryMessage[]> {
  return (await fetchDiscoverySample(token, limit, now)).messages;
}
