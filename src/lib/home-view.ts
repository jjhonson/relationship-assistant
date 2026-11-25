import { buildConnectionCandidates } from "./connection-subjects";
import type { ConnectionEvidence } from "./connection-subjects";
import type { RelationshipRecord } from "./relationship-record";

/** A compact, source-backed conversation possibility, never a contact task. */
export type HomeOpportunity = {
  id: string;
  relationshipId: string;
  personLabel: string;
  basisId: string;
  topic: string;
  context: string;
  observedAt: string;
  evidence: ConnectionEvidence[];
};

/** Treat malformed or impossible interaction dates as unknown. */
function knownInteractionDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : "";
}

/**
 * Oldest *known* meaningful interaction first. Unknown is never interpreted
 * as old, recent or proof that an interaction occurred.
 */
export function orderHomeRelationships(people: RelationshipRecord[]) {
  return [...people].sort((a, b) => {
    const ad = knownInteractionDate(a.lastInteractionAt);
    const bd = knownInteractionDate(b.lastInteractionAt);
    if (!ad && bd) return 1;
    if (ad && !bd) return -1;
    if (ad !== bd) return ad.localeCompare(bd);
    return a.personLabel.localeCompare(b.personLabel);
  });
}

/** Only dated, attributed context. No generic 'reach out' from a stale contact. */
export function homeRelationshipDetail(person: RelationshipRecord): string | null {
  const sourced = new Set(person.sources.map((source) => source.id));
  const thread = [...(person.activeThreads ?? [])]
    .filter((item) => item.sourceIds.some((id) => sourced.has(id)))
    .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt))[0];
  if (thread?.topic.trim()) return thread.topic.trim();
  const fact = [...(person.durableFacts ?? [])]
    .filter((item) => item.category === "Interest" &&
      item.sourceIds.some((id) => sourced.has(id)))
    .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt))[0];
  return fact?.value.trim() || null;
}

export function homeInteractionDate(value: string | null): string {
  const known = knownInteractionDate(value);
  if (!known) return "Not recorded";
  const date = new Date(known + "T00:00:00.000Z");
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

/**
 * Suggestions are intentionally conservative. A sourced active thread is
 * meaningful context; a single sourced Interest is weaker context, not proof
 * of enthusiasm. No inference from recency alone, unsourced claims, user tasks,
 * or a saved PRIVATE personal moment.
 *
 * Dismissal is handled by buildConnectionCandidates so unchanged evidence
 * cannot regenerate the same opportunity.
 */
export function selectHomeOpportunities(
  people: RelationshipRecord[],
  userLabel: string,
  limit = 3,
): HomeOpportunity[] {
  const opportunities: HomeOpportunity[] = [];
  for (const person of people) {
    // A dismissed idea must not reappear as another label for the same
    // unchanged evidence. A genuinely new source can still qualify later.
    const dismissed = person.dismissedConnectionSubjects ?? [];
    const candidates = buildConnectionCandidates(person, userLabel).filter((item) =>
      !dismissed.some((decision) => item.evidence.length > 0 &&
        item.evidence.every((source) => decision.sourceIds.includes(source.id))));
    const thread = candidates.find((item) => item.kind === "thread");
    const interest = candidates.find((item) => item.kind === "fact" &&
      (person.durableFacts ?? []).some((fact) => "fact:" + fact.id === item.id &&
        fact.category === "Interest"));
    const candidate = thread ?? interest;
    if (!candidate || !candidate.evidence.length) continue;

    const recordThread = candidate.kind === "thread" ?
      (person.activeThreads ?? []).find((item) => "thread:" + item.id === candidate.id) : null;
    const recordFact = candidate.kind === "fact" ?
      (person.durableFacts ?? []).find((item) => "fact:" + item.id === candidate.id) : null;

    const topic = (recordThread?.topic || recordFact?.value || "").trim();
    const context = recordThread
      ? [recordThread.state, recordThread.whyItMatters].filter(Boolean).join(" · ").trim()
      : "An interest they mentioned previously, not necessarily a current priority.";
    if (!topic || !context) continue;
    const observedAt = candidate.evidence.map((source) => source.observedAt).sort().at(-1) ?? "";
    opportunities.push({
      id: person.id + ":" + candidate.id,
      relationshipId: person.id,
      personLabel: person.personLabel,
      basisId: candidate.id,
      topic, context, observedAt,
      evidence: candidate.evidence,
    });
  }
  return opportunities.sort((a, b) =>
    b.observedAt.localeCompare(a.observedAt) || a.personLabel.localeCompare(b.personLabel)
  ).slice(0, Math.max(0, Math.min(limit, 3)));
}
