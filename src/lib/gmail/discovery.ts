import type { DiscoveryMessage } from "./messages";
import { getSubdomain } from "tldts";

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

export type AnalysisOptions = {
  /** Account-owner addresses known from the Gmail profile; suppressed as candidates. */
  ownerAddresses?: string[];
};

export type ProbeOutcome = "counted" | "self" | "otherRole" | "bulk" | "group" | "automated" | "unparseable" | "draft";

/** Contains no address; safe to render, but still private to the local user. */
export type ProbeReport = {
  status: "displayed" | "viable-below-cutoff" | "excluded" | "not-sampled" | "inconclusive";
  /** 1-based position among all viable candidates when viable. */
  rank: number | null;
  viableCount: number;
  displayLimit: number;
  messagesMentioning: number;
  outcomes: Record<ProbeOutcome, number>;
  /** Aggregate-level exclusion applied after per-message counting. */
  aggregateExclusion: "high-volume-one-way" | "single-inbound" | null;
  explanation: string;
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
  const subdomain = getSubdomain(domain);
  return AUTOMATED_LOCAL.test(local) ||
    Boolean(subdomain && MARKETING_SUBDOMAIN.test(`${subdomain}.`)) ||
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

function selfAddresses(messages: DiscoveryMessage[], owner: string[] = []): Set<string> {
  return new Set([
    ...owner.map((address) => address.trim().toLowerCase()).filter(Boolean),
    ...messages
      .filter((message) => message.labelIds?.includes("SENT") && !message.labelIds.includes("DRAFT"))
      .flatMap((message) => addresses(header(message, "From")).map((person) => person.address)),
  ]);
}

const emptyOutcomes = (): Record<ProbeOutcome, number> => ({
  counted: 0,
  self: 0,
  otherRole: 0,
  bulk: 0,
  group: 0,
  automated: 0,
  unparseable: 0,
  draft: 0,
});

/** Does this message's From/To/Cc mention the address (including in headers that failed to parse)? */
function mentions(message: DiscoveryMessage, address: string): boolean {
  return ["From", "To", "Cc"].some((name) => {
    const value = header(message, name);
    const parsed = parseAddresses(value);
    if (parsed.people.some((person) => person.address === address)) return true;
    if (parsed.reliable) return false;
    const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const addressChars = "A-Z0-9.!#$%&'*+/=?^_\u0060{|}~-";
    const completeAddress = new RegExp(`(?:^|[^${addressChars}])${escaped}(?:$|[^${addressChars}])`, "i");
    return splitMailboxes(value).some((part) =>
      parseAddresses(part).people.length === 0 && completeAddress.test(part),
    );
  });
}

/**
 * Stage-one seeds for bounded enrichment: addresses the user directly wrote to
 * (single recipient, not bulk or automated), ordered by how many distinct years
 * and messages they appear in. Only used in memory to build Gmail search queries.
 */
export function enrichmentTargets(messages: DiscoveryMessage[], maximum: number, ownerAddresses: string[] = []): string[] {
  const self = selfAddresses(messages, ownerAddresses);
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

const DISPLAY_LIMIT = 10;

/** Single implementation of filtering and ranking, shared by discovery and the positive-control diagnostic. */
function analyze(
  allMessages: DiscoveryMessage[],
  maximum: number,
  options: AnalysisOptions = {},
  probe?: string,
): DiscoveryAnalysis & {
  viableCount: number;
  probe: Omit<ProbeReport, "status" | "explanation" | "rank" | "viableCount" | "displayLimit"> & {
    rank: number | null;
    sentMessagesMentioning: number;
  };
} {
  const diagnostics = emptyDiagnostics();
  const outcomes = emptyOutcomes();
  let messagesMentioning = 0;
  let sentMessagesMentioning = 0;
  let aggregateExclusion: ProbeReport["aggregateExclusion"] = null;
  const drafts = allMessages.filter((message) => message.labelIds?.includes("DRAFT"));
  diagnostics.excludedDraft = drafts.length;
  if (probe) {
    const mentioned = drafts.filter((message) => mentions(message, probe)).length;
    outcomes.draft += mentioned;
    messagesMentioning += mentioned;
  }
  const messages = allMessages.filter((message) => !message.labelIds?.includes("DRAFT"));
  diagnostics.messagesExamined = messages.length;
  const self = selfAddresses(messages, options.ownerAddresses);
  const candidates = new Map<string, Aggregate>();
  const months = new Set<string>();

  for (const message of messages) {
    const sent = message.labelIds?.includes("SENT") ?? false;
    if (sent) diagnostics.sentExamined++;
    else diagnostics.receivedExamined++;
    const when = messageDate(message);
    if (when) months.add(when.toISOString().slice(0, 7));
    const mentioned = probe ? mentions(message, probe) : false;
    if (mentioned) {
      messagesMentioning++;
      if (sent) sentMessagesMentioning++;
    }
    const note = (outcome: ProbeOutcome) => {
      if (mentioned) outcomes[outcome]++;
    };
    if (isBulk(message)) {
      diagnostics.excludedBulk++;
      note("bulk");
      continue;
    }
    const from = parseAddresses(header(message, "From"));
    const to = parseAddresses(header(message, "To"));
    const cc = parseAddresses(header(message, "Cc"));
    if (!from.reliable || !to.reliable || !cc.reliable) {
      diagnostics.excludedUnparseable++;
      note("unparseable");
      continue;
    }
    const sender = distinctPeople(from.people);
    const recipients = distinctPeople([...to.people, ...cc.people]);
    if (recipients.length !== 1 || sender.length !== 1) {
      diagnostics.excludedGroup++;
      note("group");
      continue;
    }
    const person: Address | undefined = sent ? recipients[0] : sender[0];

    if (!person || self.has(person.address)) {
      note(self.has(probe ?? "") ? "self" : "otherRole");
      continue;
    }
    if (isAutomationAddress(person.address, person.name)) {
      diagnostics.excludedAutomated++;
      note("automated");
      continue;
    }
    if (mentioned) outcomes[person.address === probe ? "counted" : self.has(probe ?? "") ? "self" : "otherRole"]++;
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
      if (candidate.address === probe) aggregateExclusion = "high-volume-one-way";
      return false;
    }
    if (candidate.threads.size < 2 || candidate.dates.size < 2) {
      diagnostics.excludedSingleInbound++;
      if (candidate.address === probe) aggregateExclusion = "single-inbound";
      return false;
    }
    return true;
  });

  const rankedAll = viable
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
    );
  const ranked = rankedAll.slice(0, Math.max(0, Math.min(Math.floor(maximum), DISPLAY_LIMIT)));
  diagnostics.candidatesSurviving = viable.length;
  const position = probe ? rankedAll.findIndex((candidate) => candidate.address === probe) : -1;
  return {
    candidates: ranked,
    diagnostics,
    viableCount: viable.length,
    probe: { rank: position >= 0 ? position + 1 : null, messagesMentioning, sentMessagesMentioning, outcomes, aggregateExclusion },
  };
}

export function analyzeDiscovery(
  messages: DiscoveryMessage[],
  maximum = DISPLAY_LIMIT,
  options: AnalysisOptions = {},
): DiscoveryAnalysis {
  const { candidates, diagnostics } = analyze(messages, maximum, options);
  return { candidates, diagnostics };
}

const OUTCOME_TEXT: Record<Exclude<ProbeOutcome, "counted">, string> = {
  self: "an address recognized as yours",
  otherRole: "a role that does not identify them as the other party",
  bulk: "mailing-list or automated-delivery headers",
  group: "messages with several recipients or senders",
  automated: "the automated-sender rules",
  unparseable: "an address header that could not be parsed reliably",
  draft: "drafts",
};

/**
 * Positive-control diagnostic: classifies one address against the same analysis used for real
 * discovery. The address is only compared in memory; the report never contains it.
 */
export function diagnoseAddress(
  messages: DiscoveryMessage[],
  address: string,
  maximum = DISPLAY_LIMIT,
  options: AnalysisOptions = {},
): ProbeReport {
  const probe = address.trim().toLowerCase();
  const result = analyze(messages, maximum, options, probe);
  const { rank, messagesMentioning, sentMessagesMentioning, outcomes, aggregateExclusion } = result.probe;
  const sentExplanation = sentMessagesMentioning === 0
    ? "No sent message to this address was observed in the sample."
    : "No sent message to this address passed the direct-contact filters.";
  const base = { rank, viableCount: result.viableCount, displayLimit: Math.min(Math.floor(maximum), DISPLAY_LIMIT), messagesMentioning, outcomes, aggregateExclusion };
  const reasons = (Object.keys(OUTCOME_TEXT) as (keyof typeof OUTCOME_TEXT)[])
    .filter((key) => outcomes[key] > 0)
    .map((key) => `${outcomes[key]} involved ${OUTCOME_TEXT[key]}`);

  if (rank !== null) {
    const displayed = rank <= base.displayLimit;
    return {
      ...base,
      status: displayed ? "displayed" : "viable-below-cutoff",
      explanation: displayed
        ? `This address is displayed (rank ${rank} of ${base.viableCount} viable candidates).`
        : `This address is a viable candidate ranked ${rank} of ${base.viableCount}, below the display cutoff of ${base.displayLimit}.`,
    };
  }
  if (messagesMentioning === 0) {
    return {
      ...base,
      status: "not-sampled",
      explanation: "This address does not appear in the From, To or Cc headers of any sampled message. It was not sampled; this does not show that no correspondence exists.",
    };
  }
  if (aggregateExclusion) {
    return {
      ...base,
      status: "excluded",
      explanation: aggregateExclusion === "high-volume-one-way"
        ? `More than the one-way limit of incoming messages was observed, so the address looks automated. ${sentExplanation}`
        : `Only a single inbound message (or one date or thread) passed the direct-contact filters, which is not enough to recommend. ${sentExplanation}`,
    };
  }
  if (outcomes.self > 0 && outcomes.counted === 0) {
    return { ...base, status: "excluded", explanation: "This address is recognized as belonging to the account owner and is suppressed." };
  }
  const exclusive = outcomes.bulk + outcomes.group + outcomes.automated + outcomes.draft;
  if (exclusive > 0 && outcomes.unparseable === 0 && outcomes.otherRole === 0 && outcomes.counted === 0) {
    return { ...base, status: "excluded", explanation: `${messagesMentioning} sampled message${messagesMentioning === 1 ? "" : "s"} mentioned this address, all excluded: ${reasons.join("; ")}.` };
  }
  return {
    ...base,
    status: "inconclusive",
    explanation: `${messagesMentioning} sampled message${messagesMentioning === 1 ? "" : "s"} mentioned this address but the evidence is insufficient to classify it${reasons.length ? ` (${reasons.join("; ")})` : ""}.`,
  };
}

export function rankCandidates(messages: DiscoveryMessage[], maximum = 10): DiscoveryCandidate[] {
  return analyzeDiscovery(messages, maximum).candidates;
}
