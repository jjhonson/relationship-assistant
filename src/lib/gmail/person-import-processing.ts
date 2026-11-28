import "server-only";
import { inspectPersonGmailMemory, savePersonGmailMemory } from "../relationship-store";
import { inferPersonGmailMemory } from "./person-import-inference";
import type { PersonImportMessage } from "./person-import-content";
import type { PersonImportScope } from "./person-import";

/**
 * Internal one-message analysis/persistence path, not a server action or
 * authorization boundary. Only a future consent-gated server caller may
 * invoke this with an exact revalidated message retrieved from Gmail.
 * Preflight skips existing/conflicting/overlapping evidence before model
 * processing; the atomic write repeats the checks against the latest state.
 */
export async function analyzeAndSavePersonGmailMessage(
  scope: PersonImportScope, message: PersonImportMessage,
  options: { apiKey: string; model?: string; fetchImpl?: typeof fetch; expectedPersonLabel?: string },
) {
  const assessment = await inspectPersonGmailMemory({ scope, candidate: message, expectedPersonLabel: options.expectedPersonLabel });
  if (assessment.kind !== "ready") return assessment;
  const prepared = await inferPersonGmailMemory({
    scope, personLabel: assessment.personLabel, message,
  }, options);
  return savePersonGmailMemory({ ...prepared, expectedPersonLabel: options.expectedPersonLabel });
}
