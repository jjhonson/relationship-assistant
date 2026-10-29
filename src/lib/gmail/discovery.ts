import type { DiscoveryMessage } from "./messages";

export type DiscoveryCandidate = {
  address: string;
  name: string;
  sent: number;
  received: number;
  threads: number;
  dates: number;
  lastExchange: string | null;
  uncertainty: "Possible" | "Two-way exchange observed" | "Repeated correspondence observed";
  reasons: string[];
};

/** Counts only; never contains addresses or other message content. */
export type DiscoveryDiagnostics = {
  messagesExamined: number;
  sentExamined: number;
  receivedExamined: number;
  excludedDraft: number;
  excludedBulk: number;
  excludedGroup: number;
  excludedAutomated: number;
  excludedUnparseable: number;
  excludedOneWayHighVolume: number;
  excludedSingleInbound: number;
  distinctMonths: number;
  candidatesSurviving: number;
};

export type DiscoveryAnalysis = {
  candidates: DiscoveryCandidate[];
  diagnostics: DiscoveryDiagnostics;
};

/** Inbound-only senders with more messages than this and no reply from the user look automated. */
const ONE_WAY_INBOUND_LIMIT = 5;

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

const AUTOMATED_LOCAL = new RegExp(
  "^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|bounces?|notifications?|notify|newsletters?|news|updates?|billing|invoices?|statements?|receipts?|orders?|order[-_.]?confirmation|confirmations?|bookings?|reservations?|alerts?|automated|auto[-_.]?reply|support|help|helpdesk|customer[-_.]?(?:care|service|support)|service|services|info|hello|hi|contact|contactus|sales|marketing|promo(?:tions?)?|deals|offers|rewards|shop|store|team|admin|security|accounts?|account[-_.]?services|feedback|survey|mail|email|digest|members?|subscriptions?|payments?|shipping|tracking)(?:[+._-].*)?$",
);
const MARKETING_SUBDOMAIN = /^(?:e|em|email|mail|mailer|news|newsletter|mg|bounce|bounces|notify|notifications?|marketing|promo|info|click|link|go|t|send|smtp)\./;
const AUTOMATED_NAME = /\b(?:no[- ]?reply|do not reply|newsletter|notifications?|customer (?:care|service|support)|support team|alerts?|order(?:s| confirmation)|receipts?|billing|deals|offers)\b/i;

function isAutomationAddress(address: string, name = ""): boolean {
  const [local, domain = ""] = address.toLowerCase().split("@");
  return AUTOMATED_LOCAL.test(local) ||
    (domain.split(".").length >= 3 && MARKETING_SUBDOMAIN.test(domain)) ||
     AUTOMATED_NAME.test(name);
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

const emptyDiagnostics = (): DiscoveryDiagnostics => ({
  messagesExamined: 0,
  sentExamined: 0,
  receivedExamined: 0,
  excludedDraft: 0,
  excludedBulk: 0,
  excludedGroup: 0,
  excludedAutomated: 0,
  excludedUnparseable: 0,
  excludedOneWayHighVolume: 0,
  excludedSingleInbound: 0,
  distinctMonths: 0,
  candidatesSurviving: 0,
});

function selfAddresses(messages: DiscoveryMessage[]): Set<string> {
  return new Set(
    messages
      .filter((message) => message.labelIds?.includes("SENT") && !message.labelIds.includes("DRAFT"))
      .flatMap((message) => addresses(header(message, "From")).map((person) => person.address)),
  );
}

/**
 * Stage-one seeds for bounded enrichment: addresses the user directly wrote to
 * (single recipient, not bulk or automated), ordered by how many distinct years
 * and messages they appear in. Only used in memory to build Gmail search queries.
 */
export function enrichmentTargets(messages: DiscoveryMessage[], maximum: number): string[] {
  const self = selfAddresses(messages);
  const seen = new Map<string, { sent: number; years: Set<number> }>();
  for (const message of messages) {
    if (!message.labelIds?.includes("SENT") || message.labelIds.includes("DRAFT") || isBulk(message)) continue;
    const to = parseAddresses(header(message, "To"));
    const cc = parseAddresses(header(message, "Cc"));
    if (!to.reliable || !cc.reliable) continue;
    const recipients = distinctPeople([...to.people, ...cc.people]);
    if (recipients.length !== 1) continue;
    const [person] = recipients;
    if (self.has(person.address) || isAutomationAddress(person.address, person.name)) continue;
    if (!/^[\w.+-]+@[\w.-]+$/.test(person.address)) continue;
    const entry = seen.get(person.address) ?? { sent: 0, years: new Set<number>() };
    entry.sent++;
    const date = messageDate(message);
    if (date) entry.years.add(date.getUTCFullYear());
    seen.set(person.address, entry);
  }
  return [...seen]
    .sort((a, b) => b[1].years.size - a[1].years.size || b[1].sent - a[1].sent || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, maximum))
    .map(([address]) => address);
}

export function analyzeDiscovery(messages: DiscoveryMessage[], maximum = 10): DiscoveryAnalysis {
  const diagnostics = emptyDiagnostics();
  diagnostics.excludedDraft = messages.filter((message) => message.labelIds?.includes("DRAFT")).length;
  messages = messages.filter((message) => !message.labelIds?.includes("DRAFT"));
  diagnostics.messagesExamined = messages.length;
  const self = selfAddresses(messages);
  const candidates = new Map<string, Aggregate>();
  const months = new Set<string>();

  for (const message of messages) {
    const sent = message.labelIds?.includes("SENT") ?? false;
    if (sent) diagnostics.sentExamined++;
    else diagnostics.receivedExamined++;
    const when = messageDate(message);
    if (when) months.add(when.toISOString().slice(0, 7));
    if (isBulk(message)) {
      diagnostics.excludedBulk++;
      continue;
    }
    const from = parseAddresses(header(message, "From"));
    const to = parseAddresses(header(message, "To"));
    const cc = parseAddresses(header(message, "Cc"));
    if (!from.reliable || !to.reliable || !cc.reliable) {
      diagnostics.excludedUnparseable++;
      continue;
    }
    const sender = distinctPeople(from.people);
    const recipients = distinctPeople([...to.people, ...cc.people]);
    if (recipients.length !== 1 || sender.length !== 1) {
      diagnostics.excludedGroup++;
      continue;
    }
    const person: Address | undefined = sent ? recipients[0] : sender[0];

    if (!person || self.has(person.address)) continue;
    if (isAutomationAddress(person.address, person.name)) {
      diagnostics.excludedAutomated++;
      continue;
    }
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
    if (when) {
      current.dates.add(when.toISOString().slice(0, 10));
      current.latest = Math.max(current.latest, when.getTime());
    }
    candidates.set(person.address, current);
  }
  diagnostics.distinctMonths = months.size;

  const viable = [...candidates.values()].filter((candidate) => {
    if (candidate.sent > 0) return true;
    if (candidate.received > ONE_WAY_INBOUND_LIMIT) {
      diagnostics.excludedOneWayHighVolume++;
      return false;
    }
    if (candidate.threads.size < 2 || candidate.dates.size < 2) {
      diagnostics.excludedSingleInbound++;
      return false;
    }
    return true;
  });

  const ranked = viable
    .map((candidate) => {
      const bilateral = candidate.sent > 0 && candidate.received > 0;
      const repeated = bilateral && candidate.threads.size > 1 && candidate.dates.size > 1;
      const reasons = [
        bilateral
          ? `Messages were observed both sent and received in this sample (${candidate.sent} sent, ${candidate.received} received); this does not confirm they are replies to each other.`
          : candidate.sent
            ? `${candidate.sent} sent message${candidate.sent === 1 ? "" : "s"} to this address ${candidate.sent === 1 ? "was" : "were"} observed; no incoming messages were seen in the sample, which does not mean none exist.`
            : `${candidate.received} message${candidate.received === 1 ? "" : "s"} from this address ${candidate.received === 1 ? "was" : "were"} observed and no sent messages were seen; one-way, unverified.`,
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
        uncertainty: repeated
          ? "Repeated correspondence observed" as const
          : bilateral
            ? "Two-way exchange observed" as const
            : "Possible" as const,
        reasons,
      };
    })
    .sort((a, b) =>
      Number(b.sent > 0 && b.received > 0) - Number(a.sent > 0 && a.received > 0) ||
      Number(b.sent > 0) - Number(a.sent > 0) ||
      b.threads - a.threads ||
      b.dates - a.dates ||
      a.address.localeCompare(b.address),
    )
    .slice(0, Math.max(0, Math.min(Math.floor(maximum), 10)));
  diagnostics.candidatesSurviving = ranked.length;
  return { candidates: ranked, diagnostics };
}

export function rankCandidates(messages: DiscoveryMessage[], maximum = 10): DiscoveryCandidate[] {
  return analyzeDiscovery(messages, maximum).candidates;
}
