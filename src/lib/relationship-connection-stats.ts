import type { RelationshipRecord } from "./relationship-record";
import type { RelationshipHistoryEntry } from "./relationship-overview";
import { validPastDate } from "./connection-journey";
import { daysSinceContact, relationshipCadence } from "./relationship-cadence";

export type ConnectionMonth = { month: string; label: string; count: number };
export type RelationshipConnectionStats = {
  recordedDays: number;
  months: ConnectionMonth[];
  group: "Recently in touch" | "Within usual cadence" | "Worth catching up" | "Insufficient history" | "No regular cadence";
};

export function relationshipConnectionStats(record: RelationshipRecord, history: RelationshipHistoryEntry[], today: string): RelationshipConnectionStats {
  const days = new Set(history.filter((entry) => entry.countsAsContact && validPastDate(entry.date, today)).map((entry) => entry.date));
  const date = new Date(today + "T00:00:00Z");
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  const months = Array.from({ length: 12 }, (_, i) => {
    const monthDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 11 + i, 1));
    const month = monthDate.toISOString().slice(0, 7);
    return { month, label: formatter.format(monthDate), count: [...days].filter((day) => day.startsWith(month)).length };
  });
  const elapsed = daysSinceContact(record, today);
  const cadence = relationshipCadence(record, today);
  // A contact date inferred from passive metadata alone cannot establish a
  // network grouping, even when an older completed interaction is recorded.
  const hasSupportingContactDay = !!record.lastInteractionAt && days.has(record.lastInteractionAt);
  const group = elapsed === null || !hasSupportingContactDay ? "Insufficient history"
    : elapsed <= 30 ? "Recently in touch"
    : !cadence ? "Insufficient history"
    : cadence.days === 0 ? "No regular cadence"
    : elapsed >= cadence.days ? "Worth catching up" : "Within usual cadence";
  return { recordedDays: months.reduce((sum, month) => sum + month.count, 0), months, group };
}
