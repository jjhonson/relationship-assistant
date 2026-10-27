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

export class ApiError extends Error {}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: ["Bearer", token].join(" ") },
    cache: "no-store",
  });
  if (res.status === 401) throw new AuthError("Unauthorized");
  if (!res.ok) throw new ApiError(`Gmail API returned ${res.status}`);
  return (await res.json()) as T;
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
