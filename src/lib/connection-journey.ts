
export const connectionEventKinds = [
  "prepared", "sent", "reply_received", "meeting_scheduled",
  "interaction_occurred", "not_pursued",
] as const;
export type ConnectionEventKind = (typeof connectionEventKinds)[number];

export type ConnectionEvent = {
  id: string;
  // Optional to keep all earlier single-event JSON records compatible.
  confirmationId?: string;
  kind: ConnectionEventKind;
  happenedOn: string;
  recordedAt: string;
  summary: string;
  // A separate, explicitly confirmed new detail. Never a raw pasted transcript.
  outcome: string;
};

export type ConnectionJourney = {
  id: string;
  relationshipId: string;
  subject: string;
  basisId: string;
  basisSourceIds: string[];
  startedAt: string;
  events: ConnectionEvent[];
};

export type ConfirmedConnectionEvent = {
  kind: ConnectionEventKind;
  happenedOn: string;
  summary: string;
  outcome: string;
};

export function validPastDate(value: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value && value <= today;
}

export function makeConnectionJourney(
  relationshipId: string,
  subject: string,
  options: { basisId?: string; basisSourceIds?: string[] } = {},
  now = new Date(),
): ConnectionJourney {
  const title = subject.trim();
  if (!relationshipId || title.length < 3 || title.length > 160) {
    throw new Error("Give this connection a short subject (3–160 characters).");
  }
  if (options.basisId && options.basisId.length > 150) {
    throw new Error("Invalid suggestion reference.");
  }
  return {
    id: crypto.randomUUID(),
    relationshipId,
    subject: title,
    basisId: options.basisId ?? "",
    basisSourceIds: [...new Set(options.basisSourceIds ?? [])],
    startedAt: now.toISOString(),
    events: [],
  };
}

export function addConnectionEvent(
  journey: ConnectionJourney,
  input: ConfirmedConnectionEvent,
  today: string,
  now = new Date(),
): { journey: ConnectionJourney; event: ConnectionEvent } {
  if (!connectionEventKinds.includes(input.kind)) {
    throw new Error("Choose what actually happened.");
  }
  if (!validPastDate(input.happenedOn, today)) {
    throw new Error("Record the date when this action occurred, not a future event.");
  }
  const summary = input.summary.trim();
  const outcome = input.outcome.trim();
  if (summary.length < 4 || summary.length > 500 || outcome.length > 500) {
    throw new Error("Provide a short summary (4–500 characters) and an optional outcome (up to 500).");
  }
  if (outcome && input.kind !== "reply_received" && input.kind !== "interaction_occurred") {
    throw new Error("An outcome can be learned only from a reply or an interaction that actually happened.");
  }
  // A prepared message is never inferred to be sent. A scheduled meeting
  // is an arrangement, not proof the meeting took place.
  const event: ConnectionEvent = {
    id: crypto.randomUUID(), kind: input.kind, happenedOn: input.happenedOn,
    summary, outcome, recordedAt: now.toISOString(),
  };
  return { journey: { ...journey, events: [...journey.events, event] }, event };
}

export function connectionStatus(journey: ConnectionJourney): "considering" | ConnectionEventKind {
  return journey.events.at(-1)?.kind ?? "considering";
}

export function connectionEventLabel(kind: "considering" | ConnectionEventKind) {
  const labels: Record<typeof kind, string> = {
    considering: "Considering",
    prepared: "Prepared, not sent",
    sent: "Sent (user-reported)",
    reply_received: "Reply received (user-reported)",
    meeting_scheduled: "Meeting scheduled, not completed",
    interaction_occurred: "Interaction happened (user-reported)",
    not_pursued: "Not pursuing",
  };
  return labels[kind];
}
