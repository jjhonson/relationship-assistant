import type { InferenceThread } from "../inference-benchmark";
import { AuthError } from "./oauth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const MAX_REAL_PILOT_MESSAGES_PER_THREAD = 25;
export const MAX_REAL_PILOT_TOTAL_MESSAGES = 50;
export const MAX_REAL_PILOT_MESSAGE_CHARS = 12_000;
export const MAX_REAL_PILOT_TOTAL_CHARS = 45_000;

type Header = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPart;
};
type GmailThread = {
  id?: string;
  messages?: GmailMessage[];
};

export type RetrievedPilotContent = {
  threads: InferenceThread[];
  sourceThreadIds: string[];
  messageCount: number;
  totalCharacters: number;
};

export class PilotContentError extends Error {}

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
    if (!retryable || attempt === 2) throw new PilotContentError(`Gmail API returned ${res.status}`);

    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 2000)
      : 250 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new PilotContentError("Gmail API request failed");
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
}

function decodeBody(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function htmlToText(value: string): string {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:br|\/p|\/div|\/li)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function collectText(part: GmailPart | undefined): { plain: string[]; html: string[] } {
  const result = { plain: [] as string[], html: [] as string[] };
  if (!part) return result;

  const visit = (current: GmailPart) => {
    if (current.filename?.trim() || current.body?.attachmentId) return;
    const mime = (current.mimeType ?? "").toLowerCase();

    if (mime.startsWith("multipart/")) {
      for (const child of current.parts ?? []) visit(child);
      return;
    }

    if (mime === "text/plain" && current.body?.data) {
      result.plain.push(decodeBody(current.body.data));
      return;
    }

    if (mime === "text/html" && current.body?.data) {
      result.html.push(htmlToText(decodeBody(current.body.data)));
    }
  };

  visit(part);
  return result;
}

export function minimizePilotMessageText(value: string): string {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^>/.test(trimmed)) continue;
    if (/^On .{3,250} wrote:$/i.test(trimmed)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)) break;
    if (/^Begin forwarded message:$/i.test(trimmed)) break;
    if (/^Sent from my (?:iPhone|iPad|Android)/i.test(trimmed)) break;
    if (trimmed === "--") break;

    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_REAL_PILOT_MESSAGE_CHARS);
}

function messageBody(message: GmailMessage): string {
  const content = collectText(message.payload);
  const selected = content.plain.length > 0 ? content.plain.join("\n") : content.html.join("\n");
  return minimizePilotMessageText(selected);
}

function messageDate(message: GmailMessage): string {
  const internal = Number(message.internalDate);
  if (Number.isFinite(internal) && internal > 0) {
    return new Date(internal).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(header(message, "Date"));
  return Number.isNaN(parsed) ? "Unknown" : new Date(parsed).toISOString().slice(0, 10);
}

function headerAddresses(value: string): string[] {
  const matches = value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((item) => item.toLowerCase()))];
}

function messageAddresses(message: GmailMessage): string[] {
  return [...new Set(
    ["From", "To", "Cc"].flatMap((name) => headerAddresses(header(message, name))),
  )];
}

function threadIncludesAlias(thread: GmailThread, aliases: Set<string>): boolean {
  return (thread.messages ?? []).some((message) =>
    messageAddresses(message).some((address) => aliases.has(address)),
  );
}

async function fetchFullThread(token: string, threadId: string): Promise<GmailThread> {
  const params = new URLSearchParams({
    format: "full",
    fields: "id,messages(id,threadId,internalDate,payload)",
  });
  return get<GmailThread>(`/threads/${encodeURIComponent(threadId)}?${params}`, token);
}

export async function fetchApprovedPilotContent(
  token: string,
  selection: {
    confirmedAliases: string[];
    selectedThreadIds: string[];
  },
): Promise<RetrievedPilotContent> {
  const threadIds = [...new Set(selection.selectedThreadIds)];
  if (threadIds.length === 0 || threadIds.length > 3) {
    throw new PilotContentError("Select between 1 and 3 approved threads.");
  }

  const aliases = new Set(selection.confirmedAliases.map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (aliases.size === 0) throw new PilotContentError("No confirmed email identity was approved.");

  const fetched = await Promise.all(threadIds.map((id) => fetchFullThread(token, id)));
  const inferenceThreads: InferenceThread[] = [];
  let totalCharacters = 0;
  let totalMessages = 0;

  for (let index = 0; index < fetched.length; index++) {
    const requestedId = threadIds[index];
    const thread = fetched[index];
    if (thread.id && thread.id !== requestedId) {
      throw new PilotContentError("Gmail returned a different thread than the one approved.");
    }
    if (!threadIncludesAlias(thread, aliases)) {
      throw new PilotContentError("An approved thread no longer includes a confirmed email identity.");
    }

    const messages = thread.messages ?? [];
    if (messages.length > MAX_REAL_PILOT_MESSAGES_PER_THREAD) {
      throw new PilotContentError("One selected thread is too large for this pilot. Choose a smaller thread.");
    }
    totalMessages += messages.length;
    if (totalMessages > MAX_REAL_PILOT_TOTAL_MESSAGES) {
      throw new PilotContentError("The selected threads contain too many messages for this pilot.");
    }

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const message = messages[messageIndex];
      const body = messageBody(message);
      totalCharacters += body.length;
      if (totalCharacters > MAX_REAL_PILOT_TOTAL_CHARS) {
        throw new PilotContentError("The selected thread content is too large for this pilot. Choose fewer or shorter threads.");
      }

      const messageId = message.id || `${requestedId}-message-${messageIndex + 1}`;
      inferenceThreads.push({
        id: `gmail:${requestedId}:${messageId}`,
        date: messageDate(message),
        from: header(message, "From") || "Unknown",
        to: [header(message, "To"), header(message, "Cc")].filter(Boolean).join("; ") || "Unknown",
        subject: header(message, "Subject") || "(no subject)",
        body,
      });
    }
  }

  inferenceThreads.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  return {
    threads: inferenceThreads,
    sourceThreadIds: threadIds,
    messageCount: totalMessages,
    totalCharacters,
  };
}
