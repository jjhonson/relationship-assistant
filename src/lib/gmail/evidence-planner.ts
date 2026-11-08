import {
  MAX_REAL_PILOT_CONVERSATIONS,
  normalizeEmailAddress,
  type ThreadCandidate,
} from "../real-contact-pilot";

export type EvidenceRole =
  | "Recent activity"
  | "Long-running exchange candidate"
  | "Historical context candidate"
  | "Early relationship anchor";

export type EvidenceRecommendation = {
  conversationId: string;
  role: EvidenceRole;
  reason: string;
  candidate: ThreadCandidate;
};

const RECENT_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function durationDays(candidate: ThreadCandidate): number {
  return Math.max(
    0,
    (Date.parse(candidate.lastDate) - Date.parse(candidate.firstDate)) / DAY_MS,
  );
}

function hasConfirmedIdentity(candidate: ThreadCandidate, aliases: Set<string>): boolean {
  return candidate.participantAddresses.some((address) => aliases.has(normalizeEmailAddress(address)));
}

function matchesStrongerDirectExchange(candidate: ThreadCandidate): boolean {
  return candidate.messageCount > 1;
}

export function planRepresentativeEvidence(
  candidates: ThreadCandidate[],
  confirmedAliases: string[],
  now = new Date(),
): EvidenceRecommendation[] {
  const aliases = new Set(confirmedAliases.map(normalizeEmailAddress));
  if (aliases.size === 0) return [];

  const direct = candidates.filter(
    (candidate) =>
      hasConfirmedIdentity(candidate, aliases) &&
      !candidate.isAutomated &&
      !candidate.isCalendarArtifact &&
      !candidate.isDraft &&
      !candidate.isGroupOnly,
  );
  const hasStrongerExchange = direct.some(matchesStrongerDirectExchange);
  const historicalEligible = direct.filter(
    (candidate) => !hasStrongerExchange || matchesStrongerDirectExchange(candidate),
  );
  const cutoff = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString().slice(0, 10);
  const recommendations: EvidenceRecommendation[] = [];
  const selected = new Set<string>();
  const add = (candidate: ThreadCandidate, role: EvidenceRole, reason: string) => {
    if (selected.has(candidate.id) || recommendations.length >= MAX_REAL_PILOT_CONVERSATIONS) return;
    selected.add(candidate.id);
    recommendations.push({ conversationId: candidate.id, role, reason, candidate });
  };

  // A single direct recent message can still be the best current-state evidence.
  // The stronger-exchange filter applies only to historical/depth slots so an older
  // multi-message thread cannot erase evidence that the relationship is active now.
  const recent = direct
    .filter((candidate) => candidate.lastDate >= cutoff)
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.messageCount - a.messageCount || a.id.localeCompare(b.id))[0];
  if (recent) {
    add(
      recent,
      "Recent activity",
      `Most recent eligible direct conversation in this sample, based on its latest sampled metadata date (${recent.lastDate}) and ${recent.messageCount} sampled matching message${recent.messageCount === 1 ? "" : "s"}.`,
    );
  }

  const historical = historicalEligible
    .filter(
      (candidate) =>
        !selected.has(candidate.id) &&
        ((candidate.lastDate < cutoff && candidate.messageCount > 1) ||
          durationDays(candidate) >= 30),
    )
    .sort(
      (a, b) =>
        b.messageCount - a.messageCount ||
        durationDays(b) - durationDays(a) ||
        a.firstDate.localeCompare(b.firstDate) ||
        a.id.localeCompare(b.id),
    )[0];
  if (historical) {
    const longRunning = durationDays(historical) >= 30;
    add(
      historical,
      longRunning ? "Long-running exchange candidate" : "Historical context candidate",
      longRunning
        ? `Sampled metadata messages span ${historical.firstDate} to ${historical.lastDate}; this may be a longer exchange, but metadata cannot establish its substance.`
        : `Older direct conversation has sampled metadata dates from ${historical.firstDate} to ${historical.lastDate} and ${historical.messageCount} sampled matching messages; metadata alone cannot establish its substance.`,
    );
  }

  const anchor = historicalEligible
    .filter(
      (candidate) =>
        !selected.has(candidate.id) &&
        (candidate.firstDate < cutoff || durationDays(candidate) >= 30),
    )
    .sort(
      (a, b) =>
        a.firstDate.localeCompare(b.firstDate) ||
        b.messageCount - a.messageCount ||
        a.id.localeCompare(b.id),
    )[0];
  if (anchor) {
    add(
      anchor,
      "Early relationship anchor",
      `Earliest remaining eligible direct conversation in this sample has a sampled date of ${anchor.firstDate}; this is a longevity cue, not a claim about its content.`,
    );
  }

  return recommendations;
}
