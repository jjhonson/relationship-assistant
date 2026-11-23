"use server";

import { revalidatePath } from "next/cache";
import { looksLikePastedConversation } from "@/lib/conversational-capture";
import {
  getRelationship, listConnectionJourneys,
  saveConfirmedConnectionEvent, startConnectionJourney,
} from "@/lib/relationship-store";
import { interpretConnectionUpdate } from "@/lib/connection-update-inference";
import { type ConfirmedConnectionEvent, type ConnectionJourney } from "@/lib/connection-journey";

function ensureDevelopment() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Connection activity is available only in local development.");
  }
}

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function assertJourney(personId: string, journeyId: string): Promise<{
  personLabel: string; journey: ConnectionJourney;
}> {
  const [person, journeys] = await Promise.all([
    getRelationship(personId), listConnectionJourneys(personId),
  ]);
  if (!person) throw new Error("Relationship not found.");
  const journey = journeys.find((item) => item.id === journeyId);
  if (!journey) throw new Error("Connection not found.");
  return { personLabel: person.personLabel, journey };
}

/** A tracked possibility is not itself evidence that contact occurred. */
export async function beginConnection(personId: string, subject: string, basisId = "") {
  ensureDevelopment();
  const journey = await startConnectionJourney(
    personId, subject, basisId, process.env.RELATIONSHIP_USER_LABEL ?? "Jason",
  );
  revalidatePath("/relationships/" + personId);
  return { id: journey.id };
}

/** Deliberate model call to help classify a first-person update; never writes. */
export async function previewConnectionActivity(personId: string, journeyId: string, text: string) {
  ensureDevelopment();
  const { personLabel, journey } = await assertJourney(personId, journeyId);
  return interpretConnectionUpdate({
    text, person: personLabel, subject: journey.subject, today: localToday(),
  }, {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_RELATIONSHIP_MODEL,
  });
}

/** Only a human-confirmed summary/status/date is persisted; raw input isn't. */
export async function confirmConnectionActivity(
  personId: string, journeyId: string, input: ConfirmedConnectionEvent,
) {
  ensureDevelopment();
  if (!input || typeof input.summary !== "string" || typeof input.outcome !== "string" ||
      typeof input.happenedOn !== "string" || typeof input.kind !== "string") {
    throw new Error("Review and confirm the action, date, and summary.");
  }
  if (looksLikePastedConversation(input.summary) || looksLikePastedConversation(input.outcome)) {
    throw new Error("Pasted conversations belong in conversational capture, not an activity summary.");
  }
  const { event } = await saveConfirmedConnectionEvent(personId, journeyId, input, localToday());
  revalidatePath("/relationships/" + personId);
  revalidatePath("/");
  return { saved: true as const, eventId: event.id };
}
