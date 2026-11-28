import type { CaptureEvent } from "./capture";
import { captureLocalDay } from "./capture-calendar";
import { connectionEventLabel, validPastDate, type ConnectionJourney } from "./connection-journey";
import type { DurableRelationshipFact, RelationshipRecord, RelationshipSource } from "./relationship-record";
import { homeInteractionDate } from "./home-view";
import { locationMeaning, locationDisplayLabel } from "./location-meaning";

/** Projection only: old and new facts stay in the original source-backed memory. */
const fields = [
  { label: "Company", categories: ["Work"], aliases: ["company", "employer", "current company", "current employer", "workplace", "employer name"] },
  { label: "Title", categories: ["Work"], aliases: ["role", "title", "job title", "job role", "current role", "current title", "position", "current position", "job position"] },
  // Internal field key retained for callers; this slot means residence only.
  { label: "Location", categories: ["Location"], aliases: [] },
  { label: "Email", categories: ["Personal", "Work", "Other"], aliases: ["email", "email address", "work email", "personal email"] },
  { label: "Phone", categories: ["Personal", "Work", "Other"], aliases: ["phone", "phone number", "mobile", "mobile number", "telephone", "cell phone"] },
  { label: "LinkedIn", categories: ["Personal", "Work", "Other"], aliases: ["linkedin", "linkedin url", "linkedin profile", "linkedin profile url"] },
  { label: "Birthday", categories: ["Personal", "Other"], aliases: ["birthday", "birth date", "date of birth"] },
] as const;

export type ContactDetail = {
  label: typeof fields[number]["label"];
  value: string;
  observedAt: string;
  sourceIds: string[];
  factIds: string[];
  confirmed?: boolean;
};

type EvidenceValue = Omit<ContactDetail, "label">;
export type ContactObservation = Pick<RelationshipSource, "id" | "source" | "label" | "observedAt"> & {
  // Older sources linked to a mutable fact may have described an earlier value.
  attribution: "value" | "earlier-context";
};
export type ContactValue = ContactDetail & { observations: ContactObservation[] };
export type ContactField = {
  label: ContactDetail["label"];
  primary: ContactValue | null;
  values: ContactValue[];
};
type MemoryLine = { id: string; value: string; date: string; label: string };
export type PortraitGroup = { label: string; items: MemoryLine[] };
export type RelationshipHistoryEntry = {
  id: string;
  date: string;
  label: string;
  detail: string;
  captureId?: string;
  countsAsContact?: boolean;
};

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesContactField(fact: DurableRelationshipFact, field: typeof fields[number], known: ReadonlyMap<string, RelationshipSource>) {
  if (field.label === "Location") return locationMeaning(fact, known) === "home";
  return (field.aliases as readonly string[]).includes(normalized(fact.label)) &&
    (field.categories as readonly string[]).includes(fact.category);
}

function dateLabel(value: string, today: string) {
  return validPastDate(value, today) ? value : "";
}

function evidenceFor(ids: string[], sources: Map<string, RelationshipSource>, today: string) {
  return [...new Set(ids)].flatMap((id) => {
    const source = sources.get(id);
    return source && dateLabel(source.observedAt, today) ? [source] : [];
  });
}

/** Conflicting values on the same most-recent day are not resolved by array order. */
function newestUnambiguous(values: ContactValue[]): ContactValue | undefined {
  // A confirmed identity establishes whose address it is, not that it is
  // still their preferred address. Use observation date, never identity
  // confirmation alone, to rank distinct addresses.
  const sorted = [...values].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const latest = sorted[0];
  if (!latest) return;
  const equallyCurrent = sorted.filter((item) => item.observedAt === latest.observedAt);
  if (equallyCurrent.some((item) => item.value !== latest.value)) return;
  return latest;
}

function plausibleContactValue(field: ContactDetail["label"], value: string) {
  const text = value.trim();
  if (!text || /^(unknown|not recorded|not provided|n\/a|none|unclear)$/i.test(text)) return false;
  if (field === "Email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  if (field === "Phone") return /^[+\d().\s-]{7,40}$/.test(text) && text.replace(/\D/g, "").length >= 7;
  if (field === "LinkedIn") {
    try {
      const url = new URL(text);
      return url.protocol === "https:" && ["linkedin.com", "www.linkedin.com"].includes(url.hostname) &&
        !url.username && !url.password && /^\/in\/[^/]+\/?$/.test(url.pathname);
    } catch { return false; }
  }
  // Preserve the evidence wording; do not guess or shorten old prose into new facts.
  return text.length <= 500;
}

function factValue(fact: DurableRelationshipFact, known: Map<string, RelationshipSource>, today: string): EvidenceValue | undefined {
  const evidence = evidenceFor(fact.sourceIds, known, today);
  if (!evidence.length || !dateLabel(fact.lastObservedAt, today)) return;
  return {
    value: fact.value.trim(), observedAt: fact.lastObservedAt,
    sourceIds: evidence.map((source) => source.id), factIds: [fact.id],
  };
}

/** Show all available evidence-backed values, including alternatives.
 * Never call an older value invalid solely because another was observed later.
 * The source list is evidence, not a count of inbound emails or live usage. */
export function relationshipContactFields(record: RelationshipRecord, today: string): ContactField[] {
  const known = new Map(record.sources.map((source) => [source.id, source]));
  return fields.map((field) => {
    const values: ContactValue[] = [];
    for (const fact of record.durableFacts) {
      if (!matchesContactField(fact, field, known) || !plausibleContactValue(field.label, fact.value)) continue;
      const value = factValue(fact, known, today);
      if (!value) continue;
      const observations = evidenceFor(value.sourceIds, known, today).map((source): ContactObservation => ({
        id: source.id, source: source.source, label: source.label, observedAt: source.observedAt,
        attribution: source.observedAt === fact.lastObservedAt ? "value" : "earlier-context",
      }));
      values.push({ label: field.label, ...value, observations });
    }
    if (field.label === "Email") {
      for (const identity of record.identities ?? []) {
        if (identity.kind !== "email" || !plausibleContactValue("Email", identity.value)) continue;
        const evidence = evidenceFor(identity.sourceIds, known, today);
        const observedAt = evidence.map((source) => source.observedAt).sort().at(-1);
        if (observedAt) values.push({
          label: field.label, value: identity.value.trim(), observedAt, sourceIds: evidence.map((source) => source.id),
          factIds: [], confirmed: identity.confirmed,
          observations: evidence.map((source) => ({ id: source.id, source: source.source,
            label: source.label, observedAt: source.observedAt, attribution: "value" })),
        });
      }
    }
    // The same email can occur in an identity and a durable fact. Count each
    // linked source only once, and prefer exact-value evidence over context.
    const distinct = new Map<string, ContactValue>();
    for (const item of values) {
      // Only email matching is case-insensitive; retain differences in URL,
      // company/title wording, phone formatting and other supplied values.
      const key = field.label === "Email" ? normalized(item.value) : item.value.trim();
      const prior = distinct.get(key);
      if (!prior) { distinct.set(key, item); continue; }
      const observations = new Map(prior.observations.map((source) => [source.id, source]));
      for (const source of item.observations) {
        if (!observations.has(source.id) || source.attribution === "value") observations.set(source.id, source);
      }
      distinct.set(key, {
        ...(item.observedAt > prior.observedAt ? item : prior),
        confirmed: prior.confirmed || item.confirmed,
        sourceIds: [...new Set([...prior.sourceIds, ...item.sourceIds])],
        factIds: [...new Set([...prior.factIds, ...item.factIds])],
        observations: [...observations.values()],
      });
    }
    const ordered = [...distinct.values()].sort((a, b) =>
      b.observedAt.localeCompare(a.observedAt) || a.value.localeCompare(b.value)).map((value) => ({
      ...value, observations: [...value.observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
    }));
    return { label: field.label, values: ordered, primary: newestUnambiguous(ordered) ?? null };
  });
}

/** Existing callers can use the compact nonempty projection. */
export function relationshipContactDetails(record: RelationshipRecord, today: string): ContactDetail[] {
  return relationshipContactFields(record, today).flatMap((field) => field.primary ? [field.primary] : []);
}

/** A useful short description, not an assertion of confirmed labels or closeness. */
export function relationshipContextLabel(record: RelationshipRecord, today: string) {
  if (record.labelAuthority === "user-confirmed") {
    const label = [...record.relationshipContexts, ...record.relationshipRoles][0];
    if (label) return { value: label, inferred: false };
  }
  const known = new Map(record.sources.map((source) => [source.id, source]));
  const inferred = [
    ...(record.inferredRelationshipContexts ?? []),
    ...(record.inferredRelationshipRoles ?? []),
  ].filter((item) => evidenceFor(item.sourceIds, known, today).length &&
    dateLabel(item.lastSuggestedAt, today));
  const latest = [...inferred].sort((a, b) => b.lastSuggestedAt.localeCompare(a.lastSuggestedAt))[0];
  return latest ? { value: latest.value, inferred: true } : null;
}

export function lastContactDescription(record: RelationshipRecord, today: string) {
  const value = record.lastInteractionAt;
  if (!value || !validPastDate(value, today)) return { date: "Not recorded", elapsed: "" };
  const days = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(value + "T00:00:00Z")) / 86_400_000);
  return {
    date: homeInteractionDate(value),
    elapsed: days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 60 ? days + " days ago" :
      days < 365 ? "About " + Math.floor(days / 30) + " months ago" :
        "About " + Math.floor(days / 365) + (days < 730 ? " year ago" : " years ago"),
  };
}

export function relationshipContextSummary(record: RelationshipRecord, details: ContactDetail[], today: string): MemoryLine[] {
  const known = new Map(record.sources.map((source) => [source.id, source]));
  const shown = new Set(details.flatMap((field) => field.factIds));
  const isContactFact = (fact: DurableRelationshipFact) => fields.some((field) => matchesContactField(fact, field, known));
  const threads = record.activeThreads.flatMap((thread) =>
    thread.state.trim() && dateLabel(thread.lastObservedAt, today) &&
    evidenceFor(thread.sourceIds, known, today).length
      ? [{ id: "thread:" + thread.id, label: thread.topic, value: thread.state, date: thread.lastObservedAt }]
      : []);
  const facts = record.durableFacts.flatMap((fact) =>
    !shown.has(fact.id) && !isContactFact(fact) && fact.value.trim() && factValue(fact, known, today)
      ? [{ id: "fact:" + fact.id, label: locationMeaning(fact, known) ? locationDisplayLabel(locationMeaning(fact, known)!) : fact.label, value: fact.value, date: fact.lastObservedAt }]
      : []);
  // Prefer the strongest two recent threads; leave the remaining evidence available below.
  const byDate = (a: MemoryLine, b: MemoryLine) => b.date.localeCompare(a.date);
  return [...threads.sort(byDate).slice(0, 2), ...facts.sort(byDate)].slice(0, 5);
}

/** A living portrait is a read-only view of explicit saved wording.
 * Category/label grouping does not imply a fact is current, retired or corrected.
 * Those temporal distinctions need a separate versioned memory model. */
export function relationshipPortrait(record: RelationshipRecord, today: string): PortraitGroup[] {
  const known = new Map(record.sources.map((source) => [source.id, source]));
  const groups = new Map<string, MemoryLine[]>();
  function add(group: string, item: MemoryLine) {
    const list = groups.get(group) ?? [];
    const typedLocation = ["Work location", "Profile location", "Location (meaning unclear)"].includes(item.label);
    if (!list.some((existing) => normalized(existing.value) === normalized(item.value) &&
      (!typedLocation || existing.label === item.label))) list.push(item);
    groups.set(group, list);
  }
  for (const fact of record.durableFacts) {
    const isContactFact = fields.some((field) => matchesContactField(fact, field, known));
    if (isContactFact || !factValue(fact, known, today) || !fact.value.trim()) continue;
    const meaning = locationMeaning(fact, known);
    const label = normalized(fact.label);
    // Use explicit labels to group, never infer cessation from age of a fact.
    // Keep the actual wording intact, including "used to" or "no longer".
    const group = /^(shared history|shared experience|shared experiences|how we met|our history)$/.test(label)
      ? "Shared history"
      : /^(former |past |previous |earlier )/.test(label)
        ? "Earlier chapters"
        : fact.category === "Family" ? "Family & life"
          : fact.category === "Interest" ? "Interests & activities"
            : meaning === "work" || fact.category === "Work" ? "Work & projects"
              : fact.category === "Location" ? "Places & plans"
                : "Other things to remember";
    add(group, { id: "fact:" + fact.id, label: meaning ? locationDisplayLabel(meaning) : fact.label, value: fact.value, date: fact.lastObservedAt });
  }
  for (const thread of record.activeThreads) {
    if (!thread.state.trim() || !dateLabel(thread.lastObservedAt, today) ||
        !evidenceFor(thread.sourceIds, known, today).length) continue;
    add("Looking ahead", { id: "thread:" + thread.id, label: thread.topic, value: thread.state,
      date: thread.lastObservedAt });
  }
  const order = ["Interests & activities", "Family & life", "Shared history", "Looking ahead",
    "Work & projects", "Earlier chapters", "Places & plans", "Other things to remember"];
  return order.flatMap((label) => {
    const items = groups.get(label);
    return items?.length ? [{ label, items: [...items].sort((a,b) => b.date.localeCompare(a.date)) }] : [];
  });
}

/** Saved interaction history is not a raw transcript archive. Never turn an
 * ingestion timestamp, an inferred identity, or a drafted message into contact. */
export function relationshipInteractionHistory(record: RelationshipRecord, captures: CaptureEvent[],
  journeys: ConnectionJourney[], today: string): RelationshipHistoryEntry[] {
  const entries: RelationshipHistoryEntry[] = [];
  for (const source of record.sources) {
    if (!(source.id.startsWith("pasted:") || source.source === "transcript") ||
        !dateLabel(source.observedAt, today)) continue;
    // A merged fact may have changed since an older conversation. Only show
    // current extracted context whose latest observation matches this source.
    const topics = [
      ...record.activeThreads.filter((t) => t.sourceIds.includes(source.id) &&
        t.lastObservedAt === source.observedAt).map((t) => t.topic),
      ...record.durableFacts.filter((f) => f.sourceIds.includes(source.id) &&
        f.lastObservedAt === source.observedAt).map((f) => f.label),
    ].filter((topic) => topic.trim());
    const unique = [...new Set(topics)].slice(0, 4);
    entries.push({ id: source.id, date: source.observedAt, label: source.label,
      countsAsContact: true, detail: unique.length ? "Remembered topics: " + unique.join(" · ") : "Saved conversation context" });
  }
  for (const capture of captures) {
    if (!capture.people.some((person) => person.relationshipId === record.id) &&
        capture.contextRelationshipId !== record.id) continue;
    const reported = capture.reportedInteractionAt && dateLabel(capture.reportedInteractionAt, today);
    const date = reported || dateLabel(captureLocalDay(capture.capturedAt), today);
    if (!date) continue;
    entries.push({ id: "capture:" + capture.id, date,
      label: reported ? "Reported conversation" : capture.source === "user-image" ? "Saved photo" : "Saved note",
      detail: capture.summary || (capture.source === "user-image" ? "Saved photo context" : "Saved personal note"),
      captureId: capture.id, countsAsContact: !!reported });
  }
  for (const journey of journeys.filter((item) => item.relationshipId === record.id)) {
    for (const event of journey.events) {
      if (!["sent", "reply_received", "interaction_occurred"].includes(event.kind) ||
          !dateLabel(event.happenedOn, today)) continue;
      entries.push({ id: "event:" + event.id, date: event.happenedOn,
        countsAsContact: event.kind === "reply_received" || event.kind === "interaction_occurred",
        label: connectionEventLabel(event.kind), detail: event.summary + (event.outcome ? " · " + event.outcome : "") });
    }
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
