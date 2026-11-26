"use server";

import { dismissRelationshipConnectionIdea } from "@/app/relationships/correction-actions";

/**
 * Dismiss only this source-backed subject. The relationship record, sources,
 * evidence and later genuinely new conversation subjects remain intact.
 * The underlying action revalidates both the person page and Home.
 */
export async function dismissHomeOpportunity(personId: string, candidateId: string) {
  await dismissRelationshipConnectionIdea(personId, candidateId);
}
