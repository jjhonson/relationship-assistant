import type { DiscoveryMessage } from "./messages";

export type DiscoveryCandidate = {
  address: string;
  name: string;
  sent: number;
  received: number;
  threads: number;
  dates: number;
  lastExchange: string | null;
  uncertainty: "Possible" | "Repeated correspondence observed";
  reasons: string[];
};

type Address = { address: string; name: string };

function header(message: DiscoveryMessage, name: string): string {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function addresses(value: string): Address[] {
  const found: Address[] = [];
  const pattern = /(?:"?([^"<]*?)"?\s*)?<([^<>]+)>|([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  for (const match of value.matchAll(pattern)) {
    const address = (match[2] ?? match[3] ?? "").trim().toLowerCase();
    if (!address.includes("@")) continue;
    const name = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
    found.push({ address, name });
  }
  return found;
}

function isAutomationAddress(address: string): boolean {
  const local = address.split("@", 1)[0].toLowerCase();
  return /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|notifications?|newsletter|updates?|billing|receipts?|orders?|alerts?|automated|auto[-_.]?reply)(?:[+._-].*)?$/.test(local);
}

function isBulk(message: DiscoveryMessage): boolean {
  return Boolean(
    header(message, "List-Id") ||
    header(message, "List-Unsubscribe") ||
    /^(?:bulk|list|junk)$/i.test(header(message, "Precedence").trim()) ||
    /^(?:auto-generated|auto-replied|auto-notified)$/i.test(header(message, "Auto-Submitted").trim()) ||
    header(message, "X-Auto-Response-Suppress"),
  );
}

function messageDate(message: DiscoveryMessage): Date | null {
  const date = message.internalDate
    ? new Date(Number(message.internalDate))
    : new Date(header(message, "Date"));
  return Number.isNaN(date.getTime()) ? null : date;
}

type Aggregate = {
  address: string;
  name: string;
  sent: number;
  received: number;
  threads: Set<string>;
  dates: Set<string>;
  latest: number;
};

export function rankCandidates(messages: DiscoveryMessage[], maximum = 10): DiscoveryCandidate[] {
  const self = new Set(
    messages
      .filter((message) => message.labelIds?.includes("SENT"))
      .flatMap((message) => addresses(header(message, "From")).map((person) => person.address)),
  );
  const candidates = new Map<string, Aggregate>();

  for (const message of messages) {
    if (isBulk(message)) continue;
    const sent = message.labelIds?.includes("SENT") ?? false;
    const sender = addresses(header(message, "From"));
    const recipients = [...addresses(header(message, "To")), ...addresses(header(message, "Cc"))]
      .filter((person) => !self.has(person.address) && !isAutomationAddress(person.address));
    let person: Address | undefined;

    if (sent) {
      if (recipients.length !== 1) continue;
      person = recipients[0];
    } else {
      if (sender.length !== 1 || recipients.length > 1) continue;
      person = sender[0];
    }

    if (!person || self.has(person.address) || isAutomationAddress(person.address)) continue;
    const current = candidates.get(person.address) ?? {
      address: person.address,
      name: person.name || person.address,
      sent: 0,
      received: 0,
      threads: new Set<string>(),
      dates: new Set<string>(),
      latest: 0,
    };
    if (!current.name || current.name === current.address) current.name = person.name || current.address;
    if (sent) current.sent++;
    else current.received++;
    current.threads.add(message.threadId || message.id);
    const date = messageDate(message);
    if (date) {
      current.dates.add(date.toISOString().slice(0, 10));
      current.latest = Math.max(current.latest, date.getTime());
    }
    candidates.set(person.address, current);
  }

  return [...candidates.values()]
    .map((candidate) => {
      const bilateral = candidate.sent > 0 && candidate.received > 0;
      const reasons = [
        bilateral
          ? `Messages were observed both sent and received (${candidate.sent} sent, ${candidate.received} received).`
          : candidate.sent
            ? `${candidate.sent} sent message${candidate.sent === 1 ? "" : "s"} to this address ${candidate.sent === 1 ? "was" : "were"} observed.`
            : `${candidate.received} message${candidate.received === 1 ? "" : "s"} from this address ${candidate.received === 1 ? "was" : "were"} observed.`,
        `They span ${candidate.dates.size} date${candidate.dates.size === 1 ? "" : "s"} and ${candidate.threads.size} thread${candidate.threads.size === 1 ? "" : "s"}.`,
      ];
      return {
        address: candidate.address,
        name: candidate.name,
        sent: candidate.sent,
        received: candidate.received,
        threads: candidate.threads.size,
        dates: candidate.dates.size,
        lastExchange: candidate.latest ? new Date(candidate.latest).toISOString().slice(0, 10) : null,
        uncertainty: bilateral && candidate.threads.size > 1 && candidate.dates.size > 1
          ? "Repeated correspondence observed" as const
          : "Possible" as const,
        reasons,
      };
    })
    .sort((a, b) =>
      Number(b.sent > 0 && b.received > 0) - Number(a.sent > 0 && a.received > 0) ||
      b.threads - a.threads ||
      b.dates - a.dates ||
      a.address.localeCompare(b.address),
    )
    .slice(0, Math.max(0, Math.min(Math.floor(maximum), 10)))
}
