import { buildConnectionCandidates } from "./connection-subjects";
import type { ConnectionEvidence } from "./connection-subjects";
import type { RelationshipRecord } from "./relationship-record";

/** A bounded read-only view of source-backed context, never a contact quota. */
export type HomeAttentionItem = {
  id: string;
  relationshipId: string;
  personLabel: string;
  subject: string;
  detail: string;
  observedAt: string;
  evidence: ConnectionEvidence[];
};
export type HomeAttention = {
  commitments: HomeAttentionItem[];
  possibleSubjects: HomeAttentionItem[];
};

function lastObserved(evidence: ConnectionEvidence[]) {
  return evidence.reduce(
    (latest, item) => item.observedAt > latest ? item.observedAt : latest,
    "",
  );
}

export function selectHomeAttention(
  relationships: RelationshipRecord[],
  userLabel: string,
): HomeAttention {
  const commitments: HomeAttentionItem[] = [];
  const possibleSubjects: HomeAttentionItem[] = [];

  for (const record of relationships) {
    const candidates = buildConnectionCandidates(record, userLabel);
    for (const candidate of candidates.filter((item) => item.kind === "commitment")) {
      commitments.push({
        id: record.id + ":" + candidate.id,
        relationshipId: record.id,
        personLabel: record.personLabel,
        subject: candidate.description,
        detail: candidate.timing,
        observedAt: lastObserved(candidate.evidence),
        evidence: candidate.evidence,
      });
    }

    // A thread suggests a topic to investigate, not an action to take.
    // At most one per person so a dense record cannot flood Home.
    const firstThread = candidates.find((item) => item.kind === "thread");
    if (firstThread) {
      const id = firstThread.id.slice("thread:".length);
      const thread = (record.activeThreads ?? []).find((item) => item.id === id);
      if (thread) possibleSubjects.push({
        id: record.id + ":" + firstThread.id,
        relationshipId: record.id,
        personLabel: record.personLabel,
        subject: thread.topic,
        detail: "Saved context, not a confirmed current development: " + thread.state,
        observedAt: firstThread.observedAt,
        evidence: firstThread.evidence,
      });
    }
  }
  const newestFirst = (a: HomeAttentionItem, b: HomeAttentionItem) =>
    b.observedAt.localeCompare(a.observedAt) || a.personLabel.localeCompare(b.personLabel);
  return {
    commitments: commitments.sort(newestFirst).slice(0, 3),
    possibleSubjects: possibleSubjects.sort(newestFirst).slice(0, 3),
  };
}
