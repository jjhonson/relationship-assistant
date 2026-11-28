import "server-only";
import { randomBytes } from "node:crypto";
import { normalizePersonImportScope, type PersonImportCandidate, type PersonImportScope } from "./person-import";
import { validatePersonImportSelection } from "./person-import-content";

export const PERSON_GMAIL_APPROVAL_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_APPROVALS = 64;
export type PersonGmailApprovalBinding = {
  profileBinding: string; sessionId: string; personId: string; personLabel: string;
};
type Selection = { scope: PersonImportScope; candidates: PersonImportCandidate[] };
type Approval = Selection & { binding: PersonGmailApprovalBinding; issuedAt: number; expiresAt: number };

function sameBinding(a: PersonGmailApprovalBinding, b: PersonGmailApprovalBinding) {
  return a.profileBinding === b.profileBinding && a.sessionId === b.sessionId &&
    a.personId === b.personId && a.personLabel === b.personLabel;
}

/** In-memory, single-use server-issued review handle. Actual affirmative
 * body/model consent is required by the caller before consume. Lost process
 * state fails closed; this is not a distributed deployment mechanism. */
export function createPersonGmailApprovalStore() {
  const approvals = new Map<string, Approval>();
  function prune(now: number) {
    for (const [id, value] of approvals) if (value.expiresAt <= now) approvals.delete(id);
  }
  return {
    prepare(selection: Selection, binding: PersonGmailApprovalBinding, now = Date.now()) {
      prune(now);
      const scope = normalizePersonImportScope(selection.scope);
      if (!binding.profileBinding || !binding.sessionId || !binding.personLabel ||
          binding.personId !== scope.personId) throw new Error("Invalid Gmail approval scope.");
      validatePersonImportSelection(scope, selection.candidates);
      for (const [id, value] of approvals) {
        if (value.binding.profileBinding === binding.profileBinding &&
            value.binding.sessionId === binding.sessionId && value.binding.personId === binding.personId) approvals.delete(id);
      }
      if (approvals.size >= MAX_PENDING_APPROVALS) throw new Error("Too many pending imports. Review again later.");
      const token = randomBytes(32).toString("base64url");
      const expiresAt = now + PERSON_GMAIL_APPROVAL_TTL_MS;
      approvals.set(token, structuredClone({ scope, candidates: selection.candidates, binding, issuedAt: now, expiresAt }));
      return { token, expiresAt };
    },
    consume(token: string, binding: PersonGmailApprovalBinding, now = Date.now()): Selection {
      prune(now);
      const approved = approvals.get(token);
      if (!approved || approved.issuedAt > now || !sameBinding(approved.binding, binding)) {
        throw new Error("Import approval expired or belongs to a different connection or person. Search again.");
      }
      approvals.delete(token);
      return { scope: structuredClone(approved.scope), candidates: structuredClone(approved.candidates) };
    },
    cancel(token: string, binding: PersonGmailApprovalBinding) {
      const approved = approvals.get(token);
      if (approved && sameBinding(approved.binding, binding)) approvals.delete(token);
    },
    cancelSession(profileBinding: string, sessionId: string) {
      for (const [id, value] of approvals) {
        if (value.binding.profileBinding === profileBinding && value.binding.sessionId === sessionId) approvals.delete(id);
      }
    },
  };
}
const globalStore = globalThis as typeof globalThis & {
  __raPersonGmailApprovals?: ReturnType<typeof createPersonGmailApprovalStore>;
};
export const personGmailApprovals = globalStore.__raPersonGmailApprovals ??= createPersonGmailApprovalStore();
