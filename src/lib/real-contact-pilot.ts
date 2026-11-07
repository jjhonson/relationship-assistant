export const MAX_REAL_PILOT_THREADS = 3;

export type AliasCandidate = {
  address: string;
  displayName?: string;
  observedMessageCount: number;
};

export type ThreadCandidate = {
  id: string;
  subject: string;
  firstDate: string;
  lastDate: string;
  messageCount: number;
  participantAddresses: string[];
};

export type ConfirmedIdentity = {
  personLabel: string;
  confirmedAliases: string[];
};

export type PilotThreadSelection = ConfirmedIdentity & {
  selectedThreadIds: string[];
};

export type PilotAnalysisDisclosure = {
  personLabel: string;
  confirmedAliases: string[];
  selectedThreadIds: string[];
  fieldsToRead: readonly ["sender/recipient", "date", "subject", "plain-text message content"];
  attachmentsIncluded: false;
  provider: "OpenAI";
  providerStorageRequested: false;
};

export function normalizeEmailAddress(address: string) {
  return address.trim().toLowerCase();
}

export function prepareAliasCandidates(candidates: AliasCandidate[]) {
  const byAddress = new Map<string, AliasCandidate>();

  for (const candidate of candidates) {
    const address = normalizeEmailAddress(candidate.address);
    if (!address || !address.includes("@")) continue;

    const existing = byAddress.get(address);
    if (!existing) {
      byAddress.set(address, { ...candidate, address });
      continue;
    }

    byAddress.set(address, {
      ...existing,
      observedMessageCount: existing.observedMessageCount + candidate.observedMessageCount,
      displayName: existing.displayName || candidate.displayName,
    });
  }

  return [...byAddress.values()];
}

export function confirmContactAliases(
  personLabel: string,
  candidates: AliasCandidate[],
  selectedAddresses: string[],
): ConfirmedIdentity {
  const known = new Set(prepareAliasCandidates(candidates).map((candidate) => candidate.address));
  const selected = [...new Set(selectedAddresses.map(normalizeEmailAddress).filter(Boolean))];

  if (selected.length === 0) {
    throw new Error("Select at least one confirmed email address.");
  }

  for (const address of selected) {
    if (!known.has(address)) {
      throw new Error("A selected email address was not present in the reviewed candidate list.");
    }
  }

  return {
    personLabel,
    confirmedAliases: selected,
  };
}

export function selectPilotThreads(
  identity: ConfirmedIdentity,
  candidates: ThreadCandidate[],
  selectedThreadIds: string[],
): PilotThreadSelection {
  const selectedIds = [...new Set(selectedThreadIds)];

  if (selectedIds.length === 0) {
    throw new Error("Select at least one thread.");
  }
  if (selectedIds.length > MAX_REAL_PILOT_THREADS) {
    throw new Error(`Select no more than ${MAX_REAL_PILOT_THREADS} threads.`);
  }

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const aliases = new Set(identity.confirmedAliases.map(normalizeEmailAddress));

  for (const id of selectedIds) {
    const candidate = byId.get(id);
    if (!candidate) throw new Error("A selected thread was not present in the reviewed candidate list.");

    const belongsToConfirmedIdentity = candidate.participantAddresses
      .map(normalizeEmailAddress)
      .some((address) => aliases.has(address));

    if (!belongsToConfirmedIdentity) {
      throw new Error("A selected thread does not include a confirmed email identity for this person.");
    }
  }

  return {
    ...identity,
    selectedThreadIds: selectedIds,
  };
}

export function buildPilotAnalysisDisclosure(selection: PilotThreadSelection): PilotAnalysisDisclosure {
  return {
    personLabel: selection.personLabel,
    confirmedAliases: selection.confirmedAliases,
    selectedThreadIds: selection.selectedThreadIds,
    fieldsToRead: ["sender/recipient", "date", "subject", "plain-text message content"],
    attachmentsIncluded: false,
    provider: "OpenAI",
    providerStorageRequested: false,
  };
}
