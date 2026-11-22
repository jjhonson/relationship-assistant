/**
 * A user-selected label for a manually pasted conversation, not a verified
 * provider integration. This material is ephemeral: only the extraction and
 * provenance label are saved to the relationship store.
 */
export const PASTED_CONVERSATION_SOURCES = [
  { value: "meeting", label: "Meeting or call", provenanceLabel: "Manually pasted meeting or call" },
  { value: "email", label: "Email thread", provenanceLabel: "Manually pasted email conversation" },
  { value: "messages", label: "Messages or chat", provenanceLabel: "Manually pasted messages or chat" },
  { value: "notes", label: "Other conversation notes", provenanceLabel: "Manually pasted conversation notes" },
] as const;

export type PastedConversationSource = (typeof PASTED_CONVERSATION_SOURCES)[number]["value"];

export function parsePastedConversation(input: {
  transcript: unknown;
  interactionDate: unknown;
  source: unknown;
}) {
  if (typeof input.transcript !== "string") {
    throw new Error("Paste a conversation or notes.");
  }
  const transcript = input.transcript.trim();
  if (!transcript || transcript.length > 80_000) {
    throw new Error("Paste a conversation or notes of up to 80,000 characters.");
  }

  if (typeof input.interactionDate !== "string") {
    throw new Error("Conversation date is required.");
  }
  const interactionDate = input.interactionDate.trim();
  const date = new Date(interactionDate + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(interactionDate) ||
      !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== interactionDate) {
    throw new Error("Enter a valid conversation date.");
  }

  const choice = PASTED_CONVERSATION_SOURCES.find((item) => item.value === input.source);
  if (!choice) throw new Error("Choose where this conversation came from.");
  return { transcript, interactionDate, sourceLabel: choice.provenanceLabel };
}
