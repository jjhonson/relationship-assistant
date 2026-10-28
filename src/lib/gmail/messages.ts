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

export async function fetchHistoricalMessages(
  token: string,
  limit: number,
  now = new Date(),
): Promise<DiscoveryMessage[]> {
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 200)) : 200;
  const years = Math.min(DISCOVERY_YEARS, cap);
  const basePerYear = Math.floor(cap / years);
  const extraYears = cap % years;
  const summaries: { id: string; threadId?: string }[] = [];

  for (let offset = 0; offset < years && summaries.length < cap; offset++) {
    const year = now.getUTCFullYear() - offset;
    const yearLimit = basePerYear + (offset < extraYears ? 1 : 0);
    let pageToken: string | undefined;
    let found = 0;
    do {
      const remaining = Math.min(yearLimit - found, cap - summaries.length);
      if (remaining <= 0) break;
      const params = new URLSearchParams({
        maxResults: String(remaining),
        q: `after:${year}/01/01 before:${year + 1}/01/01`,
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await get<{
        messages?: { id: string; threadId?: string }[];
        nextPageToken?: string;
      }>(`/messages?${params}`, token);
      const messages = page.messages ?? [];
      summaries.push(...messages.slice(0, remaining));
      found += messages.length;
      pageToken = page.nextPageToken;
    } while (pageToken && found < yearLimit && summaries.length < cap);
  }

  const results: DiscoveryMessage[] = [];
  for (let start = 0; start < summaries.length; start += 5) {
    const batch = summaries.slice(start, start + 5);
    const fetched = await Promise.all(
      batch.map(({ id, threadId }) => {
        const params = new URLSearchParams({
          format: "metadata",
          fields: "id,threadId,internalDate,labelIds,payload(headers)",
        });
        for (const header of [
          "From",
          "To",
          "Cc",
          "Date",
          "List-Id",
          "List-Unsubscribe",
          "Precedence",
          "Auto-Submitted",
          "X-Auto-Response-Suppress",
        ]) {
          params.append("metadataHeaders", header);
        }
        return get<DiscoveryMessage>(
          `/messages/${encodeURIComponent(id)}?${params}`,
          token,
        ).then((message) => ({ ...message, threadId: message.threadId ?? threadId }));
      }),
    );
    results.push(...fetched);
  }
  return results;
}
