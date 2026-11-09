import {
  evaluateRelationshipInference,
  validateRelationshipInference,
  type RelationshipBenchmarkCase,
  type RelationshipInference,
} from "./inference-benchmark";
import {
  RELATIONSHIP_INFERENCE_SYSTEM_PROMPT,
  buildRelationshipInferenceUserPrompt,
  type RelationshipInferenceInput,
} from "./inference-prompt";

export const DEFAULT_OPENAI_RELATIONSHIP_MODEL = "gpt-6.1-sol";

export const relationshipInferenceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "classification",
    "relationshipContexts",
    "relationshipRoles",
    "disposition",
    "currentState",
    "tags",
    "history",
    "openLoops",
    "reasonsToEngage",
    "unknowns",
    "confidence",
  ],
  properties: {
    classification: evidenceEnum([
      "Friend or family",
      "Recruiter",
      "Coworker",
      "Service provider",
      "Professional contact",
      "Unknown",
    ]),
    relationshipContexts: evidenceArray([
      "Personal relationship",
      "Family",
      "Current coworker",
      "Former colleague",
      "Recruiter",
      "Service provider",
      "Professional contact",
    ]),
    relationshipRoles: evidenceArray([
      "Friend",
      "Mentor",
      "Mentee",
      "Advisor",
      "Sponsor",
      "Peer",
      "Collaborator",
    ]),
    disposition: evidenceEnum(["Relationship worth managing", "Background only", "Unclear"]),
    currentState: evidenceEnum(["Active", "Occasional", "Dormant", "Recently revived", "Unclear"]),
    tags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "evidenceIds"],
        properties: {
          label: { type: "string" },
          evidenceIds: stringArray(),
        },
      },
    },
    history: {
      type: "object",
      additionalProperties: false,
      required: [
        "earliestObservedMeaningfulInteraction",
        "latestObservedMeaningfulInteraction",
        "pattern",
        "evidenceIds",
      ],
      properties: {
        earliestObservedMeaningfulInteraction: { type: "string" },
        latestObservedMeaningfulInteraction: { type: "string" },
        pattern: { type: "string" },
        evidenceIds: stringArray(),
      },
    },
    openLoops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["commitment", "owner", "status", "evidenceIds"],
        properties: {
          commitment: { type: "string" },
          owner: { type: "string" },
          status: { type: "string", enum: ["Open", "Overdue", "Unclear"] },
          evidenceIds: stringArray(),
        },
      },
    },
    reasonsToEngage: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reason", "evidenceIds"],
        properties: {
          reason: { type: "string" },
          evidenceIds: stringArray(),
        },
      },
    },
    unknowns: stringArray(),
    confidence: { type: "string", enum: ["Low", "Moderate", "High"] },
  },
} as const;

function stringArray() {
  return { type: "array", items: { type: "string" } } as const;
}

function evidenceEnum(values: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "evidenceIds"],
    properties: {
      value: { type: "string", enum: values },
      evidenceIds: stringArray(),
    },
  } as const;
}

function evidenceArray(values: readonly string[]) {
  return {
    type: "array",
    items: evidenceEnum(values),
  } as const;
}

type OpenAIResponse = {
  id?: string;
  status?: string;
  model?: string;
  output?: Array<{
    type?: string;
    content?: Array<
      | { type?: "output_text"; text?: string }
      | { type?: "refusal"; refusal?: string }
      | Record<string, unknown>
    >;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

function extractOutputText(response: OpenAIResponse) {
  const texts: string[] = [];
  const refusals: string[] = [];

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") texts.push(content.text);
      if (content.type === "refusal" && typeof content.refusal === "string") refusals.push(content.refusal);
    }
  }

  if (refusals.length > 0) throw new Error("Model refused the relationship inference request.");
  const text = texts.join("\n").trim();
  if (!text) throw new Error("Model returned no structured text output.");
  return text;
}

function citedEvidenceIds(inference: RelationshipInference): string[] {
  return [
    ...inference.classification.evidenceIds,
    ...inference.relationshipContexts.flatMap((item) => item.evidenceIds),
    ...inference.relationshipRoles.flatMap((item) => item.evidenceIds),
    ...inference.disposition.evidenceIds,
    ...inference.currentState.evidenceIds,
    ...inference.history.evidenceIds,
    ...inference.tags.flatMap((tag) => tag.evidenceIds),
    ...inference.openLoops.flatMap((loop) => loop.evidenceIds),
    ...inference.reasonsToEngage.flatMap((reason) => reason.evidenceIds),
  ];
}

export function invalidInferenceCitations(
  input: RelationshipInferenceInput,
  inference: RelationshipInference,
): string[] {
  const allowed = new Set(input.messages.map((message) => message.id));
  return [...new Set(citedEvidenceIds(inference).filter((id) => !allowed.has(id)))];
}

type InferenceOptions = {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

async function requestRelationshipInference(
  input: RelationshipInferenceInput,
  options: InferenceOptions,
) {
  if (!options.apiKey) throw new Error("OPENAI_API_KEY is required.");
  if (input.messages.length === 0) throw new Error("At least one correspondence message is required.");
  if (new Set(input.messages.map((message) => message.id)).size !== input.messages.length) {
    throw new Error("Correspondence evidence IDs must be unique.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? DEFAULT_OPENAI_RELATIONSHIP_MODEL;

  const result = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "medium" },
      instructions: RELATIONSHIP_INFERENCE_SYSTEM_PROMPT,
      input: buildRelationshipInferenceUserPrompt(input),
      text: {
        format: {
          type: "json_schema",
          name: "relationship_inference",
          strict: true,
          schema: relationshipInferenceJsonSchema,
        },
      },
    }),
  });

  if (!result.ok) {
    throw new Error(`OpenAI inference request failed with status ${result.status}.`);
  }

  const response = (await result.json()) as OpenAIResponse;
  const outputText = extractOutputText(response);
  let inference: RelationshipInference;
  try {
    inference = JSON.parse(outputText) as RelationshipInference;
  } catch {
    throw new Error("OpenAI returned output that could not be parsed as JSON.");
  }

  const validationIssues = validateRelationshipInference(inference);
  if (validationIssues.length > 0) {
    throw new Error(`Structured inference failed local validation: ${validationIssues.join(" ")}`);
  }

  const invalidCitations = invalidInferenceCitations(input, inference);
  if (invalidCitations.length > 0) {
    throw new Error("Structured inference cited evidence that was not supplied.");
  }

  return {
    provider: "openai" as const,
    model: response.model ?? model,
    responseId: response.id ?? null,
    inference,
    invalidCitations,
    usage: {
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    },
  };
}

function benchmarkInput(benchmark: RelationshipBenchmarkCase): RelationshipInferenceInput {
  return {
    id: benchmark.id,
    title: benchmark.title,
    asOfDate: benchmark.asOfDate,
    messages: benchmark.threads.map((thread) => ({
      ...thread,
      source: "fixture",
      conversationId: thread.id,
    })),
  };
}

export async function inferRelationshipFromCorrespondence(
  input: RelationshipInferenceInput,
  options: InferenceOptions,
) {
  return requestRelationshipInference(input, options);
}

export async function inferRelationshipWithOpenAI(
  benchmark: RelationshipBenchmarkCase,
  options: InferenceOptions,
) {
  const result = await requestRelationshipInference(benchmarkInput(benchmark), options);
  return {
    ...result,
    report: evaluateRelationshipInference(benchmark, result.inference),
  };
}
