"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { listRelationships, inspectPersonGmailBatch } from "@/lib/relationship-store";
import { captureLocalDay } from "@/lib/capture-calendar";
import { fetchOwnerAddress, isLookupAddress } from "@/lib/gmail/messages";
import { fetchPilotAliasMetadata, aliasCandidatesFromMetadata, MAX_PILOT_ALIASES } from "@/lib/gmail/pilot-metadata";
import { lookupPersonImportPlan, normalizePersonImportScope } from "@/lib/gmail/person-import";
import { hasPersonImportAddressConflict } from "@/lib/gmail/person-import-memory";
import { retrievePersonImportContent } from "@/lib/gmail/person-import-content";
import { analyzeAndSavePersonGmailMessage } from "@/lib/gmail/person-import-processing";
import { personGmailApprovals } from "@/lib/gmail/person-import-consent";
import { personalGmailSessionContext, freshPersonalGmailAccess } from "@/lib/gmail/personal-connection";
import { PERSONAL_GMAIL_ORIGIN, validPersonGmailId } from "@/lib/gmail/personal-session";
import { PERSON_GMAIL_ALPHA_BATCH_LIMIT, type GmailAliasResult, type GmailPlanResult, type GmailImportResult } from "./gmail-import-types";

function error(message: string) { return { kind: "error" as const, message }; }

async function context(id: string) {
  if (!validPersonGmailId(id) || (await headers()).get("origin") !== PERSONAL_GMAIL_ORIGIN) {
    throw new Error("Invalid import request.");
  }
  const connected = await personalGmailSessionContext();
  if (!connected) throw new Error("Connect your personal Gmail account first.");
  const records = await listRelationships();
  const person = records.find((item) => item.id === id);
  if (!person) throw new Error("Relationship unavailable.");
  return { connected, records, person, binding: {
    profileBinding: connected.profileBinding, sessionId: connected.session.id, personId: person.id, personLabel: person.personLabel,
    ...(person.gmailMemoryRevision === undefined ? {} : { memoryRevision: person.gmailMemoryRevision }),
  } };
}

function checkedAddresses(addresses: unknown) {
  if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > MAX_PILOT_ALIASES ||
      addresses.some((address) => typeof address !== "string" || !isLookupAddress(address.trim()))) {
    return null;
  }
  return [...new Set((addresses as string[]).map((address) => address.trim().toLowerCase()))];
}

/** Explicit name lookup: at most 24 message headers, never bodies, no save or AI. */
export async function findPersonGmailAddresses(personId: string, metadataApproved: boolean): Promise<GmailAliasResult> {
  if (metadataApproved !== true) return error("Approve the contact-specific header search first.");
  try {
    const { connected, records, person } = await context(personId);
    const token = await freshPersonalGmailAccess(connected);
    const mailbox = await fetchOwnerAddress(token);
    if (!mailbox || !isLookupAddress(mailbox)) return error("The connected mailbox could not be verified.");
    const sample = await fetchPilotAliasMetadata(token, person.personLabel);
    const suggestions = aliasCandidatesFromMetadata(sample.messages, person.personLabel, [mailbox])
      .filter((candidate) => isLookupAddress(candidate.address) &&
        !hasPersonImportAddressConflict(records, person.id, [candidate.address])).slice(0, 12)
      .map(({ address, displayName, observedMessageCount }) => ({ address, displayName: displayName?.slice(0, 100), observedMessageCount }));
    return { kind: "aliases", suggestions, partial: sample.truncated };
  } catch { return error("The address search could not be completed. Check the connection and try again."); }
}

/** Explicit identity confirmation and bounded metadata-only search. The exact
 * resulting message selection is held on the server, not trusted from the UI. */
export async function preparePersonGmailReview(personId: string, addresses: string[], metadataApproved: boolean): Promise<GmailPlanResult> {
  if (metadataApproved !== true) return error("Confirm the addresses and header-search permission first.");
  const aliases = checkedAddresses(addresses);
  if (!aliases) return error("Enter between one and five valid email addresses belonging to this person.");
  try {
    const { connected, records, person, binding } = await context(personId);
    personGmailApprovals.cancelPerson(binding);
    if (hasPersonImportAddressConflict(records, person.id, aliases)) return error("An address is already associated with a different relationship. Review the address before importing.");
    const token = await freshPersonalGmailAccess(connected);
    const mailbox = await fetchOwnerAddress(token);
    if (!mailbox || !isLookupAddress(mailbox)) return error("The connected mailbox could not be verified.");
    const scope = normalizePersonImportScope({ personId: person.id, mailboxAddress: mailbox, confirmedAddresses: aliases,
      ...(person.gmailMemoryRevision === undefined ? {} : { memoryRevision: person.gmailMemoryRevision }) });
    const previouslyImportedKeys = person.sources.flatMap((source) => source.gmailImport ? [source.gmailImport.providerKey] : []);
    const plan = await lookupPersonImportPlan(token, scope, previouslyImportedKeys);
    const assessed = await inspectPersonGmailBatch(plan.scope, plan.candidates, person.personLabel);
    const ready = assessed.filter((item) => item.kind === "ready" && item.personLabel === person.personLabel).map((item) => item.candidate);
    const selected = ready.slice(-PERSON_GMAIL_ALPHA_BATCH_LIMIT);
    const counts = {
      scanned: plan.scannedCount, excluded: plan.excludedCount,
      previouslyImported: plan.previouslyImportedCount + assessed.filter((item) => item.kind === "duplicate").length,
      reviewNeeded: assessed.length - ready.length - assessed.filter((item) => item.kind === "duplicate").length,
      moreAvailable: plan.moreAvailable || ready.length > selected.length,
    };
    if (!selected.length) return { kind: "empty", ...counts };
    const { token: approval, expiresAt } = personGmailApprovals.prepare({ scope: plan.scope, candidates: selected }, binding);
    return { kind: "review", review: {
      token: approval, expiresAt, mailbox: scope.mailboxAddress, addresses: scope.confirmedAddresses,
      messages: selected.map(({ observedAt, direction }) => ({ day: captureLocalDay(observedAt), direction })),
      ...counts,
    } };
  } catch { return error("The email search could not be completed. Check the connection and confirmed addresses."); }
}

export async function cancelPersonGmailReview(personId: string, approval: string): Promise<void> {
  try {
    const { binding } = await context(personId);
    personGmailApprovals.cancel(approval, binding);
  } catch { /* A disconnected or expired session cannot use the approval. */ }
}

/** Explicit, one-use review plus separate body and AI/cost approvals. No
 * provider requests before validation, and no raw message leaves the server
 * except the previously disclosed, bounded inference request to OpenAI. */
export async function importPersonGmailReview(personId: string, approval: string,
  bodyApproved: boolean, modelApproved: boolean): Promise<GmailImportResult> {
  if (bodyApproved !== true || modelApproved !== true) return error("Approve both email reading and AI processing first.");
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RELATIONSHIP_MODEL?.trim();
  if (process.env.RA_PERSONAL_GMAIL_MODEL_APPROVED !== "yes" || !apiKey || !model) {
    return error("Live Gmail AI processing has not been enabled.");
  }
  if (typeof approval !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(approval)) return error("Invalid or expired review. Search again.");
  let selection: ReturnType<typeof personGmailApprovals.consume>;
  let approvedPersonLabel: string;
  let connected: NonNullable<Awaited<ReturnType<typeof personalGmailSessionContext>>>;
  try {
    const current = await context(personId);
    connected = current.connected;
    approvedPersonLabel = current.person.personLabel;
    selection = personGmailApprovals.consume(approval, current.binding);
    if (selection.candidates.length > PERSON_GMAIL_ALPHA_BATCH_LIMIT ||
        hasPersonImportAddressConflict(current.records, current.person.id, selection.scope.confirmedAddresses)) {
      return error("The approved scope changed. Search again.");
    }
  } catch { return error("Import approval expired or the selected person or connection changed. Search again."); }
  const result = { kind: "complete" as const, saved: 0, duplicate: 0, reviewNeeded: 0, skippedContent: 0,
    deferredFacts: 0, unconfirmed: 0, notAttempted: 0 };
  try {
    const assessed = await inspectPersonGmailBatch(selection.scope, selection.candidates, approvedPersonLabel);
    result.duplicate += assessed.filter((item) => item.kind === "duplicate").length;
    result.reviewNeeded += assessed.filter((item) => item.kind === "needs-review").length;
    const ready = assessed.filter((item) => item.kind === "ready").map((item) => item.candidate);
    if (!ready.length) return result;
    const access = await freshPersonalGmailAccess(connected);
    const content = await retrievePersonImportContent(access, selection.scope, ready);
    result.skippedContent = content.skipped.length;
    for (let index = 0; index < content.messages.length; index++) {
      try {
        const outcome = await analyzeAndSavePersonGmailMessage(selection.scope, content.messages[index], {
          apiKey, model, expectedPersonLabel: approvedPersonLabel,
        });
        if (outcome.kind === "saved") { result.saved++; result.deferredFacts += outcome.deferredFactCount; }
        else if (outcome.kind === "duplicate") result.duplicate++;
        else result.reviewNeeded++;
      } catch {
        // A lost response could follow a successful atomic write. Never claim
        // the failed message was definitely unsaved. Exact provider keys make retries safe.
        result.unconfirmed++;
        result.notAttempted += content.messages.length - index - 1;
        break;
      }
    }
  } catch {
    return error("The selected email content could not be retrieved. No new memory processing was started. Search again.");
  }
  revalidatePath("/relationships/" + encodeURIComponent(personId));
  revalidatePath("/relationships");
  revalidatePath("/");
  return result;
}
