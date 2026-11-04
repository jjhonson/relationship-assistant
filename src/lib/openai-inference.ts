import {
  evaluateRelationshipInference,
  validateRelationshipInference,
  type RelationshipBenchmarkCase,
  type RelationshipInference,
} from "./inference-benchmark";
import {
  RELATIONSHIP_INFERENCE_SYSTEM_PROMPT,
  buildRelationshipInferenceUserPrompt,
} from "./inference-prompt";

export const DEFAULT_OPENAI_RELATIONSHIP_MODEL = "gpt-6.1-sol";

export const relationshipInferenceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "classification",
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

  if (refusals.length > 0) throw new Error("Model refused the fictional inference request.");
  const text = texts.join("\n").trim();
  if (!text) throw new Error("Model returned no structured text output.");
  return text;
}

export async function inferRelationshipWithOpenAI(
  benchmark: RelationshipBenchmarkCase,
  options: {
    apiKey: string;
    model?: string;
    fetchImpl?: typeof fetch;
  },
) {
  if (!options.apiKey) throw new Error("OPENAI_API_KEY is required.");

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
      input: buildRelationshipInferenceUserPrompt(benchmark),
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

  return {
    provider: "openai" as const,
    model: response.model ?? model,
    responseId: response.id ?? null,
    inference,
    report: evaluateRelationshipInference(benchmark, inference),
    usage: {
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    },
  };
}
