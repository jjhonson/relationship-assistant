export type CorrespondenceSource =
  | "gmail"
  | "linkedin"
  | "sms"
  | "whatsapp"
  | "slack"
  | "meeting"
  | "fixture";

export type CorrespondenceSelection = {
  source: CorrespondenceSource;
  personLabel: string;
  confirmedIdentityKeys: string[];
  selectedConversationIds: string[];
};

export type CorrespondenceMessage = {
  /** Globally unique evidence ID within one inference request. */
  id: string;
  source: CorrespondenceSource;
  /** Source-native conversation identifier, e.g. Gmail thread ID. */
  conversationId: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  body: string;
};

export type RetrievedCorrespondence = {
  source: CorrespondenceSource;
  messages: CorrespondenceMessage[];
  sourceConversationIds: string[];
  messageCount: number;
  totalCharacters: number;
};

export type ConversationCandidate = {
  id: string;
  subject: string;
  firstDate: string;
  lastDate: string;
  messageCount: number;
  participantIdentityKeys: string[];
};
