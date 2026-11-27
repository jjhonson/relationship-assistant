import type { HomePersonChoice } from "./home-identity";

export type ConversationDraft = { relationshipId: string | null };

export function personForPath(pathname: string, people: HomePersonChoice[]) {
  return people.find((person) => pathname.replace(/\/$/, "") === "/relationships/" + encodeURIComponent(person.id));
}

/** Once a user starts a draft, navigation must not silently change its person. */
export function conversationScope(pathname: string, people: HomePersonChoice[], draft: ConversationDraft | null) {
  return draft ? draft.relationshipId ?? undefined : personForPath(pathname, people)?.id;
}

/** The directory always lists every saved person by display name unless a
 * query narrows the list. Keep the original records and their identifiers. */
export function filterDirectoryPeople<T extends HomePersonChoice>(query: string, people: readonly T[]): T[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return people.filter((person) => tokens.every((token) => person.label.toLowerCase().includes(token)))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}
