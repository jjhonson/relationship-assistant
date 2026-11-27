import { buildConnectionCandidates } from "./connection-subjects";
import type { ConnectionEvidence } from "./connection-subjects";
import type { RelationshipRecord } from "./relationship-record";
import { dueCadence, relationshipToday } from "./relationship-cadence";

/** A grounded reason to consider contact, not merely a remembered topic. */
export type HomeOpportunity = {
  id: string;
  relationshipId: string;
  personLabel: string;
  basisId: string;
  topic: string;
  context: string;
  observedAt: string;
  evidence: ConnectionEvidence[];
  kind: "commitment" | "cadence";
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
 * Home answers "why now?", not "what could we talk about?".
 * Old interests, active threads, and future plans remain available for on-demand
 * preparation. They are never promoted merely because they were remembered.
 * No live external events are monitored in this release.
 */
export function selectHomeOpportunities(
  people: RelationshipRecord[],
  userLabel: string,
  limit = 3,
  today = relationshipToday(),
): HomeOpportunity[] {
  const opportunities: Array<HomeOpportunity & { priority: number; daysPast: number }> = [];
  for (const person of people) {
    const commitments = buildConnectionCandidates(person, userLabel)
      .filter((item) => item.kind === "commitment")
      .filter((item) => item.evidence.some((source) => knownInteractionDate(source.observedAt) &&
        source.observedAt <= today))
      .sort((a, b) => Number(b.timing.includes("Overdue")) - Number(a.timing.includes("Overdue")) ||
        b.evidence.map((s) => s.observedAt).sort().at(-1)!.localeCompare(
          a.evidence.map((s) => s.observedAt).sort().at(-1)!));
    const commitment = commitments[0];
    if (commitment) {
      const evidence = commitment.evidence.filter((source) =>
        knownInteractionDate(source.observedAt) && source.observedAt <= today);
      opportunities.push({
        id: person.id + ":" + commitment.id, relationshipId: person.id,
        personLabel: person.personLabel, basisId: commitment.id, kind: "commitment",
        topic: commitment.description,
        context: "A commitment you made. " + commitment.timing + ".",
        observedAt: evidence.map((s) => s.observedAt).sort().at(-1) ?? "",
        evidence, priority: commitment.timing.includes("Overdue") ? 0 : 1, daysPast: 0,
      });
      continue;
    }
    const due = dueCadence(person, today);
    if (!due) continue;
    const last = person.lastInteractionAt!;
    opportunities.push({
      id: person.id + ":" + due.basisId, relationshipId: person.id,
      personLabel: person.personLabel, basisId: due.basisId, kind: "cadence",
      topic: "Time to catch up?",
      context: "Last recorded contact " + homeInteractionDate(last) + ". " +
        (due.userSelected ? "Your preferred cadence: " : "Suggested cadence: ") +
        due.label.toLowerCase() + ". Revisit your saved context if it feels natural.",
      observedAt: last,
      evidence: person.sources.filter((source) => source.observedAt === last &&
        (source.id.startsWith("pasted:") || source.source === "transcript" ||
         source.id.startsWith("connection-event:") || source.label === "Your note about a reported conversation"))
        .map(({ id, label, observedAt }) => ({ id, label, observedAt })),
      priority: 2, daysPast: due.daysPast,
    });
  }
  return opportunities.sort((a, b) => a.priority - b.priority || b.daysPast - a.daysPast ||
    b.observedAt.localeCompare(a.observedAt) || a.personLabel.localeCompare(b.personLabel))
    .slice(0, Math.max(0, Math.min(limit, 3)))
    .map(({ priority: _priority, daysPast: _daysPast, ...item }) => {
      // Explicit projection keeps internal ranking fields out of the view.
      void _priority; void _daysPast;
      return item;
    });
}
