import type { CaptureInterpretation, CaptureKind, CaptureSource } from "./conversational-capture";
import { looksLikePastedConversation } from "./conversational-capture";
import type { HomePersonChoice } from "./home-identity";
import { suggestHomePerson } from "./home-identity";

type KnownKind = Exclude<CaptureKind, "uncertain">;
export type HomeCaptureChoices = {
  kind?: KnownKind;
  relationshipId?: string;
  newPersonLabel?: string;
  interactionDate?: string;
};
export type HomeCapturePlan =
  | { state: "clarify"; field: "kind" | "person" | "date"; question: string;
      kind?: KnownKind; choices: HomeCaptureChoices }
  | { state: "ready"; kind: KnownKind; source: CaptureSource;
      relationshipId: string; interactionDate: string; choices: HomeCaptureChoices };

function validDay(value: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function precedingDay(today: string) {
  if (!validDay(today, today)) throw new Error("Local date unavailable.");
  const date = new Date(today + "T12:00:00.000Z");
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Only a FIRST-PERSON report of a conversation/encounter can establish the
 * interaction date. "Judy might run tomorrow" never establishes a conversation
 * date, even though it contains a time expression.
 *
 * Deterministic local-day extraction prevents UTC midnight from moving a
 * Nov 25 Denver "yesterday" conversation to Nov 25 or Nov 26.
 */
export function reportedConversationDay(text: string, localToday: string): string {
  const sentence = text.split(/[.!?\n]/).find((line) =>
    /\b(?:I|we)\s+(?:spoke|talked|met|called|chatted|caught up|had (?:a|an) (?:call|conversation|meeting))\b/i.test(line));
  if (!sentence) return "";
  const encounter = /\b(?:I|we)\s+(?:spoke|talked|met|called|chatted|caught up|had (?:a|an) (?:call|conversation|meeting))\b/i.exec(sentence);
  if (!encounter) return "";
  const preceding = sentence.slice(0, encounter.index).trim().replace(/,$/, "").trim();
  // "Yesterday I met Judy" is an unambiguous first-person event date.
  if (/^(today|yesterday)$/i.test(preceding)) {
    return preceding.toLowerCase() === "today" ? localToday : precedingDay(localToday);
  }
  // "I spoke with Judy yesterday" is dated. "I spoke with Judy ABOUT
  // her race yesterday" is not: the date might refer to the race.
  const after = sentence.slice(encounter.index + encounter[0].length).split(/[,;:]/)[0];
  const rel = /\b(yesterday|today)\b/i.exec(after);
  if (!rel) return "";
  const between = after.slice(0, rel.index);
  if (between.trim().split(/\s+/).length > 9 ||
      /\b(?:about|because|since|who|which|that|she|he|they|when|while|before|after)\b/i.test(between)) {
    return "";
  }
  return rel[1].toLowerCase() === "today" ? localToday : precedingDay(localToday);
}

export function planHomeCapture(input: {
  text: string;
  interpretation: CaptureInterpretation;
  people: HomePersonChoice[];
  today: string;
  choices?: HomeCaptureChoices;
  importedTextFile?: boolean;
  // Optional relationship-page context, not an instruction to merge identities.
  contextRelationshipId?: string;
}): HomeCapturePlan {
  const { text, interpretation, people, today } = input;
  const choices = input.choices ?? {};
  const type = choices.kind ?? interpretation.kind;

  // Even a mistaken model interpretation or an explicit choice cannot cause
  // recognizable pasted third-party dialogue to be retained as a user note.
  const pasted = looksLikePastedConversation(text);
  const kind = pasted ? "conversation" : type;
  if (input.importedTextFile && !choices.kind && kind !== "conversation") {
    return {
      state: "clarify", field: "kind",
      question: "Is this your own writing or copied conversation material?",
      choices,
    };
  }
  if (kind === "uncertain") return {
    state: "clarify", field: "kind",
    question: "Is this your own note, a private thought, or a pasted conversation?",
    choices,
  };
  // An explicit first-person memory conflicts with the model's "pasted
  // conversation" or "moment" category. Ask about authorship before choosing
  // whether to preserve the user's words or discard the pasted original.
  if (!pasted && !choices.kind && kind !== "note" &&
      reportedConversationDay(text, today)) {
    return {
      state: "clarify", field: "kind",
      question: "Is this your own recollection or a pasted conversation?",
      choices,
    };
  }
  if (kind === "moment") return {
    state: "ready", kind, source: "unspecified",
    relationshipId: "", interactionDate: "", choices,
  };

  const hint = suggestHomePerson(text, people);
  const contextId = input.contextRelationshipId ?? "";
  if (contextId && !people.some((person) => person.id === contextId)) {
    throw new Error("The open relationship is no longer available.");
  }
  // An explicit mention of another saved person or multiple possible
  // people overrides the implicit context and must be clarified.
  const conflictingPerson = Boolean(contextId && hint.id && hint.id !== contextId);
  const needsChoice = (hint.ambiguous || conflictingPerson) && !choices.relationshipId;
  const selected = choices.relationshipId ?? hint.id ?? contextId;
  if (!selected || needsChoice) {
    return {
      state: "clarify", field: "person", kind,
      question: needsChoice
        ? "Which saved person is this about?"
        : kind === "conversation"
          ? "Who was this conversation with?"
          : "Who is this note about?",
      choices,
    };
  }
  if (selected !== "__new__" && !people.some((person) => person.id === selected)) {
    throw new Error("The selected relationship is no longer available.");
  }
  if (kind === "conversation" && selected === "__new__") {
    const name = choices.newPersonLabel?.trim() ?? "";
    if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) {
      return { state: "clarify", field: "person", kind,
        question: "What is the name of the person in this conversation?", choices };
    }
  }

  const textDay = reportedConversationDay(text, today);
  const date = choices.interactionDate || (
    kind === "conversation" ? interpretation.interactionDate || textDay : textDay
  );
  if (date && !validDay(date, today)) throw new Error("Enter a valid past conversation date.");
  if (kind === "conversation" && !date) return {
    state: "clarify", field: "date", kind,
    question: interpretation.question || "When did this conversation happen?",
    choices,
  };
  return {
    state: "ready", kind,
    source: kind === "conversation" ? interpretation.source : "unspecified",
    relationshipId: selected === "__new__" ? "" : selected,
    interactionDate: date,
    choices,
  };
}
