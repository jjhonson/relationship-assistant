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

const bareAddress = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i;

type ParsedAddresses = { people: Address[]; reliable: boolean };

function parseAddresses(value: string): ParsedAddresses {
  const people: Address[] = [];
  let reliable = true;
  for (const part of splitMailboxes(value)) {
    const named = part.match(/^([\s\S]*)<([^<>]+)>\s*(?:\([^)]*\))?$/);
    const raw = (named ? named[2] : part.replace(/\([^)]*\)/g, "")).trim().toLowerCase();
    if (!bareAddress.test(raw)) {
      reliable = false;
      continue;
    }
    const name = named ? named[1].trim().replace(/^"([\s\S]*)"$/, "$1").replace(/\\(.)/g, "$1").trim() : "";
    people.push({ address: raw, name });
  }
  return { people, reliable };
}

function distinctPeople(people: Address[]): Address[] {
  const seen = new Map<string, Address>();
  for (const person of people) {
    const existing = seen.get(person.address);
    if (!existing || (!existing.name && person.name)) seen.set(person.address, person);
  }
  return [...seen.values()];
}

function addresses(value: string): Address[] {
  return parseAddresses(value).people;
}

function isAutomationAddress(address: string): boolean {
  const local = address.split("@", 1)[0].toLowerCase();
  return /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|notifications?|newsletter|updates?|billing|receipts?|orders?|alerts?|automated|auto[-_.]?reply)(?:[+._-].*)?$/.test(local);
}

function isAutoSubmitted(value: string): boolean {
  const token = value.split(";", 1)[0].trim().toLowerCase();
  return token !== "" && token !== "no";
}

function isBulk(message: DiscoveryMessage): boolean {
  return Boolean(
    header(message, "List-Id") ||
    header(message, "List-Unsubscribe") ||
    /^(?:bulk|list|junk)$/i.test(header(message, "Precedence").trim()) ||
    isAutoSubmitted(header(message, "Auto-Submitted")) ||
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
  messages = messages.filter((message) => !message.labelIds?.includes("DRAFT"));
  const self = new Set(
    messages
      .filter((message) => message.labelIds?.includes("SENT"))
      .flatMap((message) => addresses(header(message, "From")).map((person) => person.address)),
  );
  const candidates = new Map<string, Aggregate>();

  for (const message of messages) {
    if (isBulk(message)) continue;
    const sent = message.labelIds?.includes("SENT") ?? false;
    const from = parseAddresses(header(message, "From"));
    const to = parseAddresses(header(message, "To"));
    const cc = parseAddresses(header(message, "Cc"));
    if (!from.reliable || !to.reliable || !cc.reliable) continue;
    const sender = distinctPeople(from.people);
    const recipients = distinctPeople([...to.people, ...cc.people]);
    if (recipients.length !== 1 || sender.length !== 1) continue;
    const person: Address | undefined = sent ? recipients[0] : sender[0];

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
