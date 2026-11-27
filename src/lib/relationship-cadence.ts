import type { RelationshipRecord } from "./relationship-record";
import { validPastDate } from "./connection-journey";

/** Small editable working defaults, not a closeness score or contact quota. */
export const contactCadenceOptions = [
  { days: 30, label: "About monthly" },
  { days: 60, label: "About every 2 months" },
  { days: 90, label: "About every 3 months" },
  { days: 180, label: "About every 6 months" },
  { days: 365, label: "About yearly" },
  { days: 0, label: "No regular cadence" },
] as const;
export type ContactCadence = { days: number; label: string; basis: string; userSelected: boolean };

function cadence(days: number, basis: string, userSelected = false): ContactCadence | null {
  const option = contactCadenceOptions.find((item) => item.days === days);
  return option ? { ...option, basis, userSelected } : null;
}

export function relationshipToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function relationshipCadence(record: RelationshipRecord, today: string): ContactCadence | null {
  // Explicitly selected preferences always outrank contextual suggestions.
  // A malformed persisted value fails closed, never silently becomes a default.
  if (record.contactCadenceDays !== undefined) {
    return cadence(record.contactCadenceDays, "Your chosen cadence", true);
  }
  const mode = record.intention?.mode;
  if (mode === "Stay in Touch") return cadence(180, "Based on your saved relationship intention");
  if (mode === "Stay Connected") return cadence(90, "Based on your saved relationship intention");
  if (mode === "Stay Close") return cadence(30, "Based on your saved relationship intention");

  const confirmed = record.labelAuthority === "user-confirmed";
  const known = new Map(record.sources.map((source) => [source.id, source]));
  const hasEvidence = (item: { sourceIds: string[]; lastSuggestedAt: string }) =>
    validPastDate(item.lastSuggestedAt, today) && item.sourceIds.some((id) => {
      const source = known.get(id);
      return !!source && validPastDate(source.observedAt, today);
    });
  const inferredContexts = (record.inferredRelationshipContexts ?? []).filter(hasEvidence).map((item) => item.value);
  const inferredRoles = (record.inferredRelationshipRoles ?? []).filter(hasEvidence).map((item) => item.value);
  const contexts = confirmed && record.relationshipContexts.length ? record.relationshipContexts : inferredContexts;
  const roles = confirmed && record.relationshipRoles.length ? record.relationshipRoles : inferredRoles;

  // Situational relationships have no automatic cadence. Never treat a label
  // inferred from one conversation as proof of close friendship.
  if (contexts.includes("Current coworker") || contexts.includes("Recruiter") ||
      contexts.includes("Service provider") || contexts.includes("Family")) return null;
  if (contexts.includes("Former colleague")) return cadence(180, "A working suggestion for a former colleague");
  if (contexts.includes("Professional contact")) return cadence(90, "A working suggestion for a professional contact");
  if (roles.includes("Friend")) return cadence(60, "A working suggestion for a friend; closeness is unknown");
  return null;
}

export function daysSinceContact(record: RelationshipRecord, today: string): number | null {
  const last = record.lastInteractionAt;
  if (!last || !validPastDate(today, today) || !validPastDate(last, today)) return null;
  return Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(last + "T00:00:00Z")) / 86_400_000);
}

export function dueCadence(record: RelationshipRecord, today: string) {
  const preference = relationshipCadence(record, today);
  const elapsed = daysSinceContact(record, today);
  if (!preference || preference.days === 0 || elapsed === null || elapsed < preference.days) return null;
  const basisId = "cadence:" + record.lastInteractionAt + ":" + preference.days;
  if (record.dismissedCadenceCycle === basisId) return null;
  return { ...preference, elapsed, basisId, daysPast: elapsed - preference.days };
}

export function parseCadencePreference(value: unknown): number | undefined {
  if (value === "suggested") return undefined;
  if (typeof value !== "string" || !contactCadenceOptions.some((item) => String(item.days) === value)) {
    throw new Error("Choose a supported contact cadence.");
  }
  return Number(value);
}

/** Editing a preference never changes the contact date, labels or memories. */
export function applyCadencePreference(record: RelationshipRecord, value: number | undefined, now = new Date()): RelationshipRecord {
  if (value !== undefined && !contactCadenceOptions.some((item) => item.days === value)) {
    throw new Error("Choose a supported contact cadence.");
  }
  const updated = { ...record, updatedAt: now.toISOString() };
  if (value === undefined) delete updated.contactCadenceDays;
  else updated.contactCadenceDays = value;
  return updated;
}

export function dismissCadenceCycle(record: RelationshipRecord, basisId: string, today: string, now = new Date()): RelationshipRecord {
  const due = dueCadence(record, today);
  if (!due || due.basisId !== basisId) throw new Error("This catch-up suggestion is no longer current.");
  return { ...record, updatedAt: now.toISOString(), dismissedCadenceCycle: basisId };
}
