import type { CaptureEvent } from "./capture";
import { connectionEventLabel, validPastDate, type ConnectionJourney } from "./connection-journey";
import type { DurableRelationshipFact, RelationshipRecord, RelationshipSource } from "./relationship-record";
import { homeInteractionDate } from "./home-view";

/** Projection only: old and new facts stay in the original source-backed memory. */
const fields = [
  { label: "Company", categories: ["Work"], aliases: ["company", "employer", "current company", "current employer", "workplace", "employer name"] },
  { label: "Title", categories: ["Work"], aliases: ["role", "title", "job title", "job role", "current role", "current title", "position", "current position", "job position"] },
  { label: "Location", categories: ["Location"], aliases: ["city", "home", "home city", "home location", "location", "residence", "current location", "current city", "current residence", "place of residence", "where they live"] },
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
type MemoryLine = { id: string; value: string; date: string; label: string };
export type RelationshipHistoryEntry = {
  id: string;
  date: string;
  label: string;
  detail: string;
  captureId?: string;
};

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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
function newestUnambiguous(values: EvidenceValue[]): EvidenceValue | undefined {
  const sorted = [...values].sort((a, b) =>
    Number(!!b.confirmed) - Number(!!a.confirmed) || b.observedAt.localeCompare(a.observedAt));
  const latest = sorted[0];
  if (!latest) return;
  const equallyCurrent = sorted.filter((item) =>
    !!item.confirmed === !!latest.confirmed && item.observedAt === latest.observedAt);
  if (equallyCurrent.some((item) => normalized(item.value) !== normalized(latest.value))) return;
  return {
    ...latest,
    sourceIds: [...new Set(equallyCurrent.flatMap((item) => item.sourceIds))],
    factIds: [...new Set(equallyCurrent.flatMap((item) => item.factIds))],
  };
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

export function relationshipContactDetails(record: RelationshipRecord, today: string): ContactDetail[] {
  const known = new Map(record.sources.map((source) => [source.id, source]));
  const result: ContactDetail[] = [];
  for (const field of fields) {
    const aliases: readonly string[] = field.aliases;
    const categories: readonly string[] = field.categories;
    const values = record.durableFacts.flatMap((fact) => {
      if (!aliases.includes(normalized(fact.label)) || !categories.includes(fact.category) ||
          !plausibleContactValue(field.label, fact.value)) return [];
      const value = factValue(fact, known, today);
      return value ? [value] : [];
    });
    if (field.label === "Email") {
      for (const identity of record.identities ?? []) {
        if (identity.kind !== "email" || !plausibleContactValue("Email", identity.value)) continue;
        const evidence = evidenceFor(identity.sourceIds, known, today);
        const observedAt = evidence.map((source) => source.observedAt).sort().at(-1);
        if (observedAt) values.push({
          value: identity.value.trim(), observedAt, sourceIds: evidence.map((source) => source.id),
          factIds: [], confirmed: identity.confirmed,
        });
      }
    }
    const latest = newestUnambiguous(values);
    if (latest) result.push({ label: field.label, ...latest });
  }
  return result;
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
  const isContactFact = (fact: DurableRelationshipFact) => fields.some((field) =>
    (field.aliases as readonly string[]).includes(normalized(fact.label)) &&
    (field.categories as readonly string[]).includes(fact.category));
  const threads = record.activeThreads.flatMap((thread) =>
    thread.state.trim() && dateLabel(thread.lastObservedAt, today) &&
    evidenceFor(thread.sourceIds, known, today).length
      ? [{ id: "thread:" + thread.id, label: thread.topic, value: thread.state, date: thread.lastObservedAt }]
      : []);
  const facts = record.durableFacts.flatMap((fact) =>
    !shown.has(fact.id) && !isContactFact(fact) && fact.value.trim() && factValue(fact, known, today)
      ? [{ id: "fact:" + fact.id, label: fact.label, value: fact.value, date: fact.lastObservedAt }]
      : []);
  // Prefer the strongest two recent threads; leave the remaining evidence available below.
  const byDate = (a: MemoryLine, b: MemoryLine) => b.date.localeCompare(a.date);
  return [...threads.sort(byDate).slice(0, 2), ...facts.sort(byDate)].slice(0, 5);
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
      detail: unique.length ? "Remembered topics: " + unique.join(" · ") : "Saved conversation context" });
  }
  for (const capture of captures) {
    if (!capture.people.some((person) => person.relationshipId === record.id) &&
        capture.contextRelationshipId !== record.id) continue;
    const reported = capture.reportedInteractionAt && dateLabel(capture.reportedInteractionAt, today);
    const date = reported || dateLabel(capture.capturedAt.slice(0, 10), today);
    if (!date) continue;
    entries.push({ id: "capture:" + capture.id, date,
      label: reported ? "Reported conversation" : capture.source === "user-image" ? "Saved photo" : "Saved note",
      detail: capture.summary || (capture.source === "user-image" ? "Saved photo context" : "Saved personal note"),
      captureId: capture.id });
  }
  for (const journey of journeys.filter((item) => item.relationshipId === record.id)) {
    for (const event of journey.events) {
      if (!["sent", "reply_received", "interaction_occurred"].includes(event.kind) ||
          !dateLabel(event.happenedOn, today)) continue;
      entries.push({ id: "event:" + event.id, date: event.happenedOn,
        label: connectionEventLabel(event.kind), detail: event.summary + (event.outcome ? " · " + event.outcome : "") });
    }
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
