import type { InteractionExtraction } from "./relationship-record";
import type {
  RelationshipContextValue,
  RelationshipRoleValue,
} from "./inference-benchmark";

export const INTERACTION_INFERENCE_SYSTEM_PROMPT = [
  "You extract relationship intelligence from one newly captured interaction.",
  "",
  "The purpose is not to summarize the whole conversation. Extract only information that could improve future relationship stewardship.",
  "",
  "Rules:",
  "- Use only facts stated or clearly supported by the interaction.",
  "- Never infer sensitive traits, diagnoses, finances, beliefs, or family relationships that are not explicit.",
  "- Durable facts are stable context likely to remain useful later: family names/relationships, location, interests, work, recurring activities, or meaningful personal context.",
  "- Order durable facts by likely usefulness in a future conversation. Prefer specific facts that help the user show up thoughtfully over background biography.",
  "- Keep each durable fact concise: usually one short sentence. Do not bundle several unrelated facts into one value.",
  "- Always capture explicit relationship anchors even when they are not immediately actionable: names and relationships of family or other important people, birthdays and anniversaries, employer/job/role, school, home/location, and durable interests.",
  "- Active threads are situations currently unfolding and likely to change: a move, renovation, job search, business decision, project, school transition, health/fitness goal, or other ongoing arc.",
  "- You will also receive the current structured relationship memory. When a durable fact or active thread clearly updates an existing item, copy its exact existing ID into existingFactId or existingThreadId. Use an empty string only for genuinely new items.",
  "- Order active threads by future relationship value: consequential unresolved situations first; routine background developments later.",
  "- Keep active-thread state and next-change signals concise. The record should be scannable without rereading the transcript.",
  "- Open loops require a genuine commitment or unresolved promise. Vague social language is not a commitment.",
  "- Stewardship opportunities are possible future reasons to engage. Do not manufacture a cadence. Prefer a concrete future change, milestone, or relevance trigger. An empty list is valid.",
  "- Return only the strongest stewardship opportunities. Three is usually enough; omit weak topical matches.",
  "- Relationship contexts and roles must be directly supported. Do not infer Former colleague merely because two people discuss work.",
  "- Preserve uncertainty in unknowns.",
  "- Do not draft outreach.",
].join("\\n");

const contextValues: RelationshipContextValue[] = [
  "Personal relationship",
  "Family",
  "Current coworker",
  "Former colleague",
  "Recruiter",
  "Service provider",
  "Professional contact",
];

const roleValues: RelationshipRoleValue[] = [
  "Friend",
  "Mentor",
  "Mentee",
  "Advisor",
  "Sponsor",
  "Peer",
  "Collaborator",
];

export const interactionExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "relationshipContexts",
    "relationshipRoles",
    "tags",
    "durableFacts",
    "activeThreads",
    "openLoops",
    "stewardshipOpportunities",
    "unknowns",
  ],
  properties: {
    summary: { type: "string" },
    relationshipContexts: {
      type: "array",
      items: { type: "string", enum: contextValues },
    },
    relationshipRoles: {
      type: "array",
      items: { type: "string", enum: roleValues },
    },
    tags: { type: "array", items: { type: "string" } },
    durableFacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["existingFactId", "category", "label", "value"],
        properties: {
          existingFactId: { type: "string" },
          category: {
            type: "string",
            enum: ["Family", "Location", "Interest", "Work", "Personal", "Other"],
          },
          label: { type: "string" },
          value: { type: "string" },
        },
      },
    },
    activeThreads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["existingThreadId", "topic", "state", "whyItMatters", "nextChangeSignal"],
        properties: {
          existingThreadId: { type: "string" },
          topic: { type: "string" },
          state: { type: "string" },
          whyItMatters: { type: "string" },
          nextChangeSignal: { type: "string" },
        },
      },
    },
    openLoops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["commitment", "owner", "status"],
        properties: {
          commitment: { type: "string" },
          owner: { type: "string" },
          status: { type: "string", enum: ["Open", "Overdue", "Unclear"] },
        },
      },
    },
    stewardshipOpportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reason", "trigger"],
        properties: {
          reason: { type: "string" },
          trigger: { type: "string" },
        },
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
  },
} as const;

type OpenAIResponse = {
  model?: string;
  output?: Array<{
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

export async function inferInteractionWithOpenAI(
  input: {
    personLabel: string;
    interactionDate: string;
    transcript: string;
    currentMemory?: {
      durableFacts: Array<{ id: string; category: string; label: string; value: string }>;
      activeThreads: Array<{ id: string; topic: string; state: string }>;
    };
  },
  options: {
    apiKey: string;
    model?: string;
    fetchImpl?: typeof fetch;
  },
) {
  if (!options.apiKey) throw new Error("OPENAI_API_KEY is required.");
  if (!input.transcript.trim()) throw new Error("Transcript is required.");
  if (input.transcript.length > 80_000) {
    throw new Error("Transcript is too large for this prototype.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? process.env.OPENAI_RELATIONSHIP_MODEL ?? "gpt-6.1-sol";
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + options.apiKey,
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "medium" },
      instructions: INTERACTION_INFERENCE_SYSTEM_PROMPT,
      input: [
        "Person: " + input.personLabel,
        "Interaction date: " + input.interactionDate,
        "",
        "Transcript:",
        input.transcript,
      ].join("\\n"),
      text: {
        format: {
          type: "json_schema",
          name: "relationship_interaction_extraction",
          strict: true,
          schema: interactionExtractionJsonSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAI interaction inference failed with status " + response.status + ".");
  }

  const payload = (await response.json()) as OpenAIResponse;
  const text = extractOutputText(payload);
  const extraction = JSON.parse(text) as InteractionExtraction;
  validateExtraction(extraction);

  return {
    extraction,
    model: payload.model ?? model,
    usage: {
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
      totalTokens: payload.usage?.total_tokens ?? null,
    },
  };
}

function extractOutputText(response: OpenAIResponse) {
  const texts: string[] = [];
  const refusals: string[] = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
      if (content.type === "refusal" && typeof content.refusal === "string") {
        refusals.push(content.refusal);
      }
    }
  }

  if (refusals.length > 0) {
    throw new Error("Model refused the interaction inference request.");
  }

  const text = texts.join("\\n").trim();
  if (!text) throw new Error("Model returned no structured interaction output.");
  return text;
}

function validateExtraction(value: InteractionExtraction) {
  if (!value || typeof value !== "object") {
    throw new Error("Interaction extraction is invalid.");
  }

  const arrays: Array<keyof InteractionExtraction> = [
    "relationshipContexts",
    "relationshipRoles",
    "tags",
    "durableFacts",
    "activeThreads",
    "openLoops",
    "stewardshipOpportunities",
    "unknowns",
  ];

  for (const key of arrays) {
    if (!Array.isArray(value[key])) {
      throw new Error("Interaction extraction field " + key + " is invalid.");
    }
  }

  if (typeof value.summary !== "string") {
    throw new Error("Interaction extraction summary is invalid.");
  }
}
