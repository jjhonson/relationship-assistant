export const PERSON_GMAIL_ALPHA_BATCH_LIMIT = 5;
export type GmailAliasSuggestion = { address: string; displayName?: string; observedMessageCount: number };
export type GmailReview = {
  token: string; expiresAt: number;
  mailbox: string; addresses: string[];
  messages: { day: string; direction: "sent" | "received" }[];
  scanned: number; excluded: number; previouslyImported: number;
  reviewNeeded: number; moreAvailable: boolean;
};
export type GmailActionError = { kind: "error"; message: string };
export type GmailAliasResult = GmailActionError | {
  kind: "aliases"; suggestions: GmailAliasSuggestion[]; partial: boolean;
};
export type GmailPlanResult = GmailActionError | {
  kind: "review"; review: GmailReview;
} | {
  kind: "empty"; scanned: number; previouslyImported: number; reviewNeeded: number;
  excluded: number; moreAvailable: boolean;
};
export type GmailImportResult = GmailActionError | {
  kind: "complete"; saved: number; duplicate: number; reviewNeeded: number;
  skippedContent: number; deferredFacts: number; unconfirmed: number; notAttempted: number;
};
