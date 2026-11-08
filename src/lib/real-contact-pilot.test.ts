import { describe, expect, it } from "vitest";
import {
  buildPilotAnalysisDisclosure,
  confirmContactAliases,
  gmailSelectionToCorrespondence,
  prepareAliasCandidates,
  selectPilotThreads,
  type AliasCandidate,
  type ThreadCandidate,
} from "./real-contact-pilot";

const aliases: AliasCandidate[] = [
  { address: "Kate@OldCompany.example", displayName: "Kate Morgan", observedMessageCount: 4 },
  { address: "kate@newcompany.example", displayName: "Kate Morgan", observedMessageCount: 7 },
  { address: "someone-else@example", displayName: "Kate Morgan", observedMessageCount: 2 },
];

const threads: ThreadCandidate[] = [
  {
    id: "thread-1",
    subject: "Career update",
    firstDate: "2024-02-01",
    lastDate: "2024-02-03",
    messageCount: 4,
    participantAddresses: ["you@example", "kate@oldcompany.example"],
    isGroupOnly: false,
  },
  {
    id: "thread-2",
    subject: "Checking in",
    firstDate: "2025-05-10",
    lastDate: "2025-05-12",
    messageCount: 3,
    participantAddresses: ["you@example", "kate@newcompany.example"],
    isGroupOnly: false,
  },
  {
    id: "thread-3",
    subject: "Coffee",
    firstDate: "2026-03-18",
    lastDate: "2026-03-18",
    messageCount: 2,
    participantAddresses: ["you@example", "kate@newcompany.example"],
    isGroupOnly: false,
  },
  {
    id: "thread-4",
    subject: "Unrelated",
    firstDate: "2026-04-01",
    lastDate: "2026-04-01",
    messageCount: 2,
    participantAddresses: ["you@example", "other@example"],
    isGroupOnly: false,
  },
];

describe("real-contact pilot identity foundation", () => {
  it("normalizes and deduplicates only exact email addresses", () => {
    const prepared = prepareAliasCandidates([
      ...aliases,
      { address: " KATE@OLDCOMPANY.EXAMPLE ", displayName: "Kate M.", observedMessageCount: 1 },
    ]);

    expect(prepared).toEqual([
      {
        address: "kate@oldcompany.example",
        displayName: "Kate Morgan",
        observedMessageCount: 5,
      },
      {
        address: "kate@newcompany.example",
        displayName: "Kate Morgan",
        observedMessageCount: 7,
      },
      {
        address: "someone-else@example",
        displayName: "Kate Morgan",
        observedMessageCount: 2,
      },
    ]);
  });

  it("does not silently merge addresses merely because display names match", () => {
    const identity = confirmContactAliases("Kate", aliases, ["kate@oldcompany.example"]);
    expect(identity.confirmedAliases).toEqual(["kate@oldcompany.example"]);
    expect(identity.confirmedAliases).not.toContain("kate@newcompany.example");
    expect(identity.confirmedAliases).not.toContain("someone-else@example");
  });

  it("allows the user to explicitly confirm multiple aliases for one person", () => {
    const identity = confirmContactAliases("Kate", aliases, [
      "KATE@OLDCOMPANY.EXAMPLE",
      "kate@newcompany.example",
    ]);

    expect(identity).toEqual({
      personLabel: "Kate",
      confirmedAliases: ["kate@oldcompany.example", "kate@newcompany.example"],
    });
  });

  it("rejects aliases that were not in the reviewed candidate list", () => {
    expect(() =>
      confirmContactAliases("Kate", aliases, ["kate@personal.example"]),
    ).toThrow("not present in the reviewed candidate list");
  });

  it("requires at least one confirmed alias", () => {
    expect(() => confirmContactAliases("Kate", aliases, [])).toThrow(
      "Select at least one confirmed email address",
    );
  });

  it("limits the real pilot to three selected conversations", () => {
    const identity = confirmContactAliases("Kate", aliases, [
      "kate@oldcompany.example",
      "kate@newcompany.example",
    ]);

    expect(() =>
      selectPilotThreads(identity, threads, ["thread-1", "thread-2", "thread-3", "thread-4"]),
    ).toThrow("Select no more than 3 conversations");
  });

  it("rejects a selected conversation that does not include a confirmed identity", () => {
    const identity = confirmContactAliases("Kate", aliases, ["kate@oldcompany.example"]);

    expect(() => selectPilotThreads(identity, threads, ["thread-4"])).toThrow(
      "does not include a confirmed identity",
    );
  });

  it("translates Gmail-specific selection into a source-agnostic disclosure", () => {
    const identity = confirmContactAliases("Kate", aliases, [
      "kate@oldcompany.example",
      "kate@newcompany.example",
    ]);
    const gmailSelection = selectPilotThreads(identity, threads, ["thread-1", "thread-2"]);
    const selection = gmailSelectionToCorrespondence(gmailSelection);
    const disclosure = buildPilotAnalysisDisclosure(selection);

    expect(selection).toEqual({
      source: "gmail",
      personLabel: "Kate",
      confirmedIdentityKeys: ["kate@oldcompany.example", "kate@newcompany.example"],
      selectedConversationIds: ["thread-1", "thread-2"],
    });
    expect(disclosure).toEqual({
      source: "gmail",
      personLabel: "Kate",
      confirmedIdentityKeys: ["kate@oldcompany.example", "kate@newcompany.example"],
      selectedConversationIds: ["thread-1", "thread-2"],
      fieldsToRead: ["sender/recipient", "date", "subject/context", "message content"],
      attachmentsIncluded: false,
      provider: "OpenAI",
      providerStorageRequested: false,
    });
  });
});
