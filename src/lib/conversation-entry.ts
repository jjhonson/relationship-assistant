import type { HomePersonChoice } from "./home-identity";

export type ConversationDraft = { relationshipId: string | null };

export function personForPath(pathname: string, people: HomePersonChoice[]) {
  return people.find((person) => pathname.replace(/\/$/, "") === "/relationships/" + encodeURIComponent(person.id));
}

/** Once a user starts a draft, navigation must not silently change its person. */
export function conversationScope(pathname: string, people: HomePersonChoice[], draft: ConversationDraft | null) {
  return draft ? draft.relationshipId ?? undefined : personForPath(pathname, people)?.id;
}

export function findSavedPeople(query: string, people: HomePersonChoice[]) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return people.filter((person) => tokens.every((token) => person.label.toLowerCase().includes(token)));
}
