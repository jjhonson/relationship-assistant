import type { RelationshipBenchmarkCase } from "./inference-benchmark";

export const RELATIONSHIP_INFERENCE_SYSTEM_PROMPT = `You infer relationship context from a small, bounded set of fictional correspondence.

Rules:
- Use only the supplied messages and as-of date.
- Distinguish observed evidence from inference.
- Cite only supplied thread IDs.
- Use Unknown or Unclear when evidence is insufficient.
- Do not infer interpersonal importance from message count alone.
- Do not convert vague social language into a firm commitment.
- Do not keep clearly past dated plans open merely because no completion email is shown.
- Do not invent external developments, employers, titles, events, or facts.
- Do not infer whether the user wants more or less contact. The user's relationship goal is explicitly outside this inference task.
- "Background only" is appropriate for completed transactional contacts that do not appear to need relationship management.
- Tags must be short, stable, reusable categories or context that could organize many contacts into smart collections (for example: hiking, job search, forecasting, Seattle).
- Do not use tags to summarize a one-time event, completion status, sentiment, praise, or message outcome.
- Return JSON only. No markdown.

Allowed classification values:
- Friend or family
- Recruiter
- Coworker
- Service provider
- Professional contact
- Unknown

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
  "classification": { "value": "...", "evidenceIds": ["thread-id"] },
  "disposition": { "value": "...", "evidenceIds": ["thread-id"] },
  "currentState": { "value": "...", "evidenceIds": ["thread-id"] },
  "tags": [{ "label": "...", "evidenceIds": ["thread-id"] }],
  "history": {
    "earliestObservedMeaningfulInteraction": "YYYY-MM-DD",
    "latestObservedMeaningfulInteraction": "YYYY-MM-DD",
    "pattern": "...",
    "evidenceIds": ["thread-id"]
  },
  "openLoops": [{
    "commitment": "...",
    "owner": "...",
    "status": "Open | Overdue | Unclear",
    "evidenceIds": ["thread-id"]
  }],
  "reasonsToEngage": [{
    "reason": "...",
    "evidenceIds": ["thread-id"]
  }],
  "unknowns": ["..."],
  "confidence": "Low | Moderate | High"
}`;

export function buildRelationshipInferenceUserPrompt(benchmark: RelationshipBenchmarkCase) {
  const threadText = benchmark.threads
    .map(
      (thread) =>
        `THREAD ${thread.id}
Date: ${thread.date}
From: ${thread.from}
To: ${thread.to}
Subject: ${thread.subject}
Body: ${thread.body}`,
    )
    .join("\n\n");

  return `Case: ${benchmark.title}
As-of date: ${benchmark.asOfDate}

Infer the relationship using only the correspondence below. The as-of date matters when deciding whether a dated commitment is open, overdue, clearly past, or unclear.

${threadText}`;
}
