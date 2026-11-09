import type { CorrespondenceMessage } from "./correspondence";

export type RelationshipInferenceInput = {
  id: string;
  title: string;
  asOfDate: string;
  messages: CorrespondenceMessage[];
};

export const RELATIONSHIP_INFERENCE_SYSTEM_PROMPT = `You infer relationship context from a small, bounded set of correspondence.

Rules:
- Use only the supplied messages and as-of date.
- Distinguish observed evidence from inference.
- Cite only supplied message evidence IDs.
- Use Unknown or Unclear when evidence is insufficient.
- Do not infer interpersonal importance from message count alone.
- Keep the coarse classification for compatibility, but use relationshipContexts and relationshipRoles to represent overlapping supported dimensions.
- relationshipContexts describe where/how the relationship is situated; relationshipRoles describe the person's supported role relative to the user.
- Return zero, one, or multiple contexts/roles. Do not force a value when evidence is insufficient.
- Friend requires evidence of an actual personal friendship, not warmth or politeness alone.
- Mentor requires explicit mentorship language or repeated, clearly consequential guidance; ordinary advice or praise is not enough.
- Former colleague requires evidence of shared employment/team context, not merely collaborating on one project.
- Do not convert vague social language into a firm commitment.
- Do not keep clearly past dated plans open merely because no completion message is shown.
- Do not invent external developments, employers, titles, events, or facts.
- Do not infer whether the user wants more or less contact. The user's relationship goal is explicitly outside this inference task.
- "Background only" is appropriate for completed transactional contacts that do not appear to need relationship management.
- Tags must be short, stable, reusable categories or context that could organize many contacts into smart collections (for example: hiking, job search, forecasting, Seattle).
- Do not use tags to summarize a one-time event, completion status, sentiment, praise, or message outcome.
- A reason to engage must be a concrete, grounded trigger or unfinished thread that plausibly makes contact timely or useful now. General relevance, relationship context, or the mere fact that someone is a collaborator is not enough.
- If no concrete trigger is present, return an empty reasonsToEngage array.
- Return JSON only. No markdown.

Allowed classification values:
- Friend or family
- Recruiter
- Coworker
- Service provider
- Professional contact
- Unknown

Allowed relationshipContext values:
- Personal relationship
- Family
- Current coworker
- Former colleague
- Recruiter
- Service provider
- Professional contact

Allowed relationshipRole values:
- Friend
- Mentor
- Mentee
- Advisor
- Sponsor
- Peer
- Collaborator

Allowed disposition values:
- Relationship worth managing
- Background only
- Unclear

Allowed currentState values:
- Active
- Occasional
- Dormant
- Recently revived
- Unclear

Allowed open-loop status values:
- Open
- Overdue
- Unclear

Required JSON shape:
{
  "classification": { "value": "...", "evidenceIds": ["message-id"] },
  "relationshipContexts": [{ "value": "...", "evidenceIds": ["message-id"] }],
  "relationshipRoles": [{ "value": "...", "evidenceIds": ["message-id"] }],
  "disposition": { "value": "...", "evidenceIds": ["message-id"] },
  "currentState": { "value": "...", "evidenceIds": ["message-id"] },
  "tags": [{ "label": "...", "evidenceIds": ["message-id"] }],
  "history": {
    "earliestObservedMeaningfulInteraction": "YYYY-MM-DD",
    "latestObservedMeaningfulInteraction": "YYYY-MM-DD",
    "pattern": "...",
    "evidenceIds": ["message-id"]
  },
  "openLoops": [{
    "commitment": "...",
    "owner": "...",
    "status": "Open | Overdue | Unclear",
    "evidenceIds": ["message-id"]
  }],
  "reasonsToEngage": [{
    "reason": "...",
    "evidenceIds": ["message-id"]
  }],
  "unknowns": ["..."],
  "confidence": "Low | Moderate | High"
}`;

export function buildRelationshipInferenceUserPrompt(input: RelationshipInferenceInput) {
  const messageText = input.messages
    .map(
      (message) =>
        `MESSAGE ${message.id}
Source: ${message.source}
Conversation: ${message.conversationId}
Date: ${message.date}
From: ${message.from}
To: ${message.to}
Subject/context: ${message.subject}
Body: ${message.body}`,
    )
    .join("\\n\\n");

  return `Case: ${input.title}
As-of date: ${input.asOfDate}

Infer the relationship using only the correspondence below. The as-of date matters when deciding whether a dated commitment is open, overdue, clearly past, or unclear.

${messageText}`;
}
