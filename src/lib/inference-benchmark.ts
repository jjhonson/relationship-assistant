import type {
  PilotClassification,
  PilotOpenLoopStatus,
  PilotRelationshipDisposition,
  PilotRelationshipState,
} from "./context-pilot";

export type InferenceThread = {
  id: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  body: string;
};

export type EvidenceValue<T> = {
  value: T;
  evidenceIds: string[];
};

export type InferredTag = {
  label: string;
  evidenceIds: string[];
};

export type InferredOpenLoop = {
  commitment: string;
  owner: string;
  status: PilotOpenLoopStatus;
  evidenceIds: string[];
};

export type InferredReason = {
  reason: string;
  evidenceIds: string[];
};

export type RelationshipContextValue =
  | "Personal relationship"
  | "Family"
  | "Current coworker"
  | "Former colleague"
  | "Recruiter"
  | "Service provider"
  | "Professional contact";

export type RelationshipRoleValue =
  | "Friend"
  | "Mentor"
  | "Mentee"
  | "Advisor"
  | "Sponsor"
  | "Peer"
  | "Collaborator";

export type RelationshipInference = {
  classification: EvidenceValue<PilotClassification>;
  relationshipContexts: EvidenceValue<RelationshipContextValue>[];
  relationshipRoles: EvidenceValue<RelationshipRoleValue>[];
  disposition: EvidenceValue<PilotRelationshipDisposition>;
  currentState: EvidenceValue<PilotRelationshipState>;
  tags: InferredTag[];
  history: {
    earliestObservedMeaningfulInteraction: string;
    latestObservedMeaningfulInteraction: string;
    pattern: string;
    evidenceIds: string[];
  };
  openLoops: InferredOpenLoop[];
  reasonsToEngage: InferredReason[];
  unknowns: string[];
  confidence: "Low" | "Moderate" | "High";
};

export type BenchmarkGroundTruth = {
  classification: PilotClassification;
  acceptableClassifications?: PilotClassification[];
  relationshipContexts: RelationshipContextValue[];
  relationshipRoles: RelationshipRoleValue[];
  disposition: PilotRelationshipDisposition;
  currentState: PilotRelationshipState;
  tags: string[];
  tagAliases?: Record<string, string[]>;
  earliestObservedMeaningfulInteraction: string;
  latestObservedMeaningfulInteraction: string;
  openLoops: Array<{
    commitment: string;
    owner: string;
    status: PilotOpenLoopStatus;
  }>;
  openLoopExpectation: "none" | "optional" | "required";
  reasonsToEngage: string[];
  unknowns: string[];
  mustNotInfer: string[];
};

export type RelationshipBenchmarkCase = {
  id: string;
  title: string;
  asOfDate: string;
  threads: InferenceThread[];
  groundTruth: BenchmarkGroundTruth;
};

export const relationshipBenchmarkCases: RelationshipBenchmarkCase[] = [
  {
    id: "active-personal",
    title: "Active meaningful personal relationship",
    asOfDate: "2026-10-25",
    threads: [
      {
        id: "personal-1",
        date: "2026-03-16",
        from: "Alex Moreno",
        to: "You",
        subject: "Saturday hike",
        body: "That trail was exactly what I needed. Thanks for listening about my dad, too. Let's get outside again when the weather cooperates.",
      },
      {
        id: "personal-2",
        date: "2026-07-11",
        from: "You",
        to: "Alex Moreno",
        subject: "Checking in",
        body: "Thinking of you after the move. I'm glad the new place is starting to feel settled. Call anytime if you need a sounding board.",
      },
      {
        id: "personal-3",
        date: "2026-10-20",
        from: "Alex Moreno",
        to: "You",
        subject: "Good catching up",
        body: "Really good talking yesterday. Appreciate you as always. Hope we can get another hike in before the snow gets serious.",
      },
    ],
    groundTruth: {
      classification: "Friend or family",
      relationshipContexts: ["Personal relationship"],
      relationshipRoles: ["Friend"],
      disposition: "Relationship worth managing",
      currentState: "Active",
      tags: ["hiking", "emotional support", "relocation"],
      tagAliases: {
        "hiking": ["hike", "outdoor hiking"],
        "emotional support": ["personal support", "support"],
        "relocation": ["move", "moving"],
      },
      earliestObservedMeaningfulInteraction: "2026-03-16",
      latestObservedMeaningfulInteraction: "2026-10-20",
      openLoops: [],
      openLoopExpectation: "none",
      reasonsToEngage: ["A shared interest in hiking provides a natural future reason to connect."],
      unknowns: ["The sample does not establish contact through phone, text, or in person outside these references."],
      mustNotInfer: [
        "Do not infer a fixed contact cadence.",
        "Do not infer that the user wants more contact.",
        "Do not turn 'hope we can get another hike in' into a firm commitment.",
      ],
    },
  },
  {
    id: "transactional-service",
    title: "Completed one-time service transaction",
    asOfDate: "2026-10-25",
    threads: [
      {
        id: "service-1",
        date: "2026-06-04",
        from: "You",
        to: "Harper Quinn",
        subject: "Airport pickup",
        body: "Our flight lands at 5:40 p.m. Is the quoted pickup still available?",
      },
      {
        id: "service-2",
        date: "2026-06-04",
        from: "Harper Quinn",
        to: "You",
        subject: "Re: Airport pickup",
        body: "Yes. I will meet you at door 506 with your name on a sign. The total is $68.",
      },
      {
        id: "service-3",
        date: "2026-06-05",
        from: "You",
        to: "Harper Quinn",
        subject: "Thank you",
        body: "Thanks for the easy pickup last night. Everything worked perfectly.",
      },
    ],
    groundTruth: {
      classification: "Service provider",
      relationshipContexts: ["Service provider"],
      relationshipRoles: [],
      disposition: "Background only",
      currentState: "Dormant",
      tags: ["travel", "airport transportation"],
      tagAliases: {
        "airport transportation": ["airport pickup", "airport pickup service", "airport transfer", "transportation"],
      },
      earliestObservedMeaningfulInteraction: "2026-06-04",
      latestObservedMeaningfulInteraction: "2026-06-05",
      openLoops: [],
      openLoopExpectation: "none",
      reasonsToEngage: [],
      unknowns: ["The correspondence does not establish any relationship beyond the completed service."],
      mustNotInfer: [
        "Do not recommend relationship nurturing.",
        "Do not infer personal significance from polite language.",
        "Do not treat the completed pickup as an open commitment.",
      ],
    },
  },
  {
    id: "recruiter-ambiguous",
    title: "Recruiter with an ambiguous outcome",
    asOfDate: "2026-10-25",
    threads: [
      {
        id: "recruiter-b1",
        date: "2026-10-08",
        from: "Jordan Blake",
        to: "You",
        subject: "Growth leadership role",
        body: "Your background looks relevant to a growth leadership search I'm running. Would you have twenty minutes next week?",
      },
      {
        id: "recruiter-b2",
        date: "2026-10-09",
        from: "You",
        to: "Jordan Blake",
        subject: "Re: Growth leadership role",
        body: "Happy to talk Tuesday afternoon. Could you send the company overview and compensation range first?",
      },
      {
        id: "recruiter-b3",
        date: "2026-10-09",
        from: "Jordan Blake",
        to: "You",
        subject: "Re: Growth leadership role",
        body: "Tuesday works. I'll send the overview and range tomorrow morning.",
      },
    ],
    groundTruth: {
      classification: "Recruiter",
      relationshipContexts: ["Recruiter"],
      relationshipRoles: [],
      disposition: "Relationship worth managing",
      currentState: "Unclear",
      tags: ["job search", "growth leadership"],
      tagAliases: {
        "job search": ["job opportunity", "career opportunity", "recruiting"],
        "growth leadership": ["growth role", "leadership role"],
      },
      earliestObservedMeaningfulInteraction: "2026-10-08",
      latestObservedMeaningfulInteraction: "2026-10-09",
      openLoops: [
        {
          commitment: "Send the company overview and compensation range",
          owner: "Jordan Blake",
          status: "Overdue",
        },
      ],
      openLoopExpectation: "required",
      reasonsToEngage: ["The promised company overview and compensation range appear outstanding."],
      unknowns: ["The sample does not establish whether the planned Tuesday conversation happened through another channel."],
      mustNotInfer: [
        "Do not infer that the user wants the role.",
        "Do not infer that the Tuesday call did or did not happen.",
        "Do not infer a long-standing recruiter relationship from this short exchange.",
      ],
    },
  },
  {
    id: "coworker-operational",
    title: "New coworker with a short operational burst",
    asOfDate: "2026-10-25",
    threads: [
      {
        id: "coworker-b1",
        date: "2026-10-13",
        from: "Priya Shah",
        to: "You",
        subject: "Forecast model",
        body: "Welcome aboard. I shared the forecast workbook and the notes from Monday's planning session.",
      },
      {
        id: "coworker-b2",
        date: "2026-10-14",
        from: "You",
        to: "Priya Shah",
        subject: "Re: Forecast model",
        body: "Thanks. I added three questions in the assumptions tab. No rush; I can also grab you after Thursday's staff meeting.",
      },
      {
        id: "coworker-b3",
        date: "2026-10-16",
        from: "Priya Shah",
        to: "You",
        subject: "Re: Forecast model",
        body: "Saw the questions. Two are answered in the comments now. Let's talk through the last one after staff.",
      },
    ],
    groundTruth: {
      classification: "Coworker",
      relationshipContexts: ["Current coworker"],
      relationshipRoles: ["Collaborator"],
      disposition: "Relationship worth managing",
      currentState: "Active",
      tags: ["workplace", "forecasting", "onboarding"],
      tagAliases: {
        "workplace": ["work", "coworker"],
        "forecasting": ["forecast", "forecast model"],
      },
      earliestObservedMeaningfulInteraction: "2026-10-13",
      latestObservedMeaningfulInteraction: "2026-10-16",
      openLoops: [
        {
          commitment: "Talk through the remaining forecast question after staff",
          owner: "You and Priya Shah",
          status: "Unclear",
        },
      ],
      openLoopExpectation: "optional",
      reasonsToEngage: [],
      unknowns: ["The sample cannot show whether the remaining question was resolved in person or in work chat."],
      mustNotInfer: [
        "Do not infer personal friendship or mentorship.",
        "Do not infer that email quietness would mean the relationship became dormant.",
        "Do not infer significance beyond an active working relationship.",
      ],
    },
  },
  {
    id: "dormant-professional",
    title: "Dormant but historically meaningful professional relationship",
    asOfDate: "2026-10-25",
    threads: [
      {
        id: "dormant-b1",
        date: "2018-09-21",
        from: "Elena Park",
        to: "You",
        subject: "Launch retrospective",
        body: "You handled a messy launch with a lot of composure. I enjoyed working through it with you and hope we get another chance.",
      },
      {
        id: "dormant-b2",
        date: "2021-02-10",
        from: "You",
        to: "Elena Park",
        subject: "Career question",
        body: "Your advice about choosing the harder operating role has stayed with me. I took the job and wanted to say thank you.",
      },
      {
        id: "dormant-b3",
        date: "2024-04-03",
        from: "Elena Park",
        to: "You",
        subject: "Re: Career update",
        body: "Great to hear the move worked out. You earned that opportunity. Keep me posted on what you decide to tackle next.",
      },
    ],
    groundTruth: {
      classification: "Professional contact",
      relationshipContexts: ["Professional contact"],
      relationshipRoles: ["Advisor"],
      disposition: "Relationship worth managing",
      currentState: "Dormant",
      tags: ["former colleague", "career guidance", "past project"],
      tagAliases: {
        "former colleague": ["former coworker", "past colleague"],
        "career guidance": ["career advice", "professional guidance"],
        "past project": ["shared project", "project collaboration"],
      },
      earliestObservedMeaningfulInteraction: "2018-09-21",
      latestObservedMeaningfulInteraction: "2024-04-03",
      openLoops: [],
      openLoopExpectation: "none",
      reasonsToEngage: ["A career update would naturally continue the thread of prior guidance and updates."],
      unknowns: ["The sample does not show whether the relationship continued through other channels after April 2024."],
      mustNotInfer: [
        "Do not infer that Elena is formally a mentor.",
        "Do not infer that the relationship is inactive outside email.",
        "Do not infer urgency solely because the last email is old.",
      ],
    },
  },
  {
    id: "multi-role-history",
    title: "Former colleague who became a mentor and friend",
    asOfDate: "2026-10-25",
    threads: [
      {
        id: "multi-role-1",
        date: "2019-06-12",
        from: "Morgan Hale",
        to: "You",
        subject: "Northstar launch",
        body: "I loved being on the Northstar team with you. We survived a difficult launch and I learned a lot from how you handled the commercial side.",
      },
      {
        id: "multi-role-2",
        date: "2023-04-10",
        from: "You",
        to: "Morgan Hale",
        subject: "Thank you",
        body: "I still lean on the advice you gave me when I took my first VP role. You were a real mentor at a moment when I needed one.",
      },
      {
        id: "multi-role-3",
        date: "2026-09-20",
        from: "Morgan Hale",
        to: "You",
        subject: "Good catching up",
        body: "Hard to believe we went from colleagues at Northstar to close friends. I am glad we have stayed in each other's lives all these years.",
      },
    ],
    groundTruth: {
      classification: "Friend or family",
      acceptableClassifications: ["Friend or family", "Professional contact"],
      relationshipContexts: ["Former colleague", "Personal relationship"],
      relationshipRoles: ["Friend", "Mentor"],
      disposition: "Relationship worth managing",
      currentState: "Active",
      tags: ["leadership", "former workplace", "career guidance"],
      tagAliases: {
        "former workplace": ["Northstar", "past workplace"],
        "career guidance": ["career advice", "professional guidance"],
      },
      earliestObservedMeaningfulInteraction: "2019-06-12",
      latestObservedMeaningfulInteraction: "2026-09-20",
      openLoops: [],
      openLoopExpectation: "none",
      reasonsToEngage: [],
      unknowns: ["The sample does not establish how often they communicate outside these messages."],
      mustNotInfer: [
        "Do not infer a family relationship.",
        "Do not infer that they are current coworkers.",
        "Do not infer a formal reporting relationship from mentorship.",
      ],
    },
  },
  {
    id: "ambiguous-contact",
    title: "Intentionally ambiguous acquaintance",
    asOfDate: "2026-10-25",
    threads: [
      {
        id: "ambiguous-1",
        date: "2026-09-18",
        from: "Sam Lee",
        to: "You",
        subject: "Great meeting you",
        body: "Really enjoyed our conversation at the summit. The discussion about scaling teams was useful. Let me know if you're ever back in Seattle.",
      },
      {
        id: "ambiguous-2",
        date: "2026-09-19",
        from: "You",
        to: "Sam Lee",
        subject: "Re: Great meeting you",
        body: "Likewise. I enjoyed it. If I'm back that way I'll reach out.",
      },
    ],
    groundTruth: {
      classification: "Unknown",
      acceptableClassifications: ["Unknown", "Professional contact"],
      relationshipContexts: [],
      relationshipRoles: [],
      disposition: "Unclear",
      currentState: "Unclear",
      tags: ["conference", "scaling teams", "Seattle"],
      tagAliases: {
        "conference": ["summit", "industry event"],
        "scaling teams": ["team scaling", "scaling organizations"],
      },
      earliestObservedMeaningfulInteraction: "2026-09-18",
      latestObservedMeaningfulInteraction: "2026-09-19",
      openLoops: [],
      openLoopExpectation: "none",
      reasonsToEngage: [],
      unknowns: [
        "The sample does not establish whether this is a professional contact, potential friend, customer, recruiter, or another relationship type.",
        "The sample does not establish whether either person expects future contact.",
      ],
      mustNotInfer: [
        "Do not convert 'let me know if you're ever back in Seattle' into a commitment.",
        "Do not infer an employer, job title, friendship, or sales relationship.",
        "Do not infer that the user wants to maintain this relationship.",
      ],
    },
  },
];

const validClassifications = new Set<PilotClassification>([
  "Friend or family",
  "Recruiter",
  "Coworker",
  "Service provider",
  "Professional contact",
  "Unknown",
]);

const validRelationshipContexts = new Set<RelationshipContextValue>([
  "Personal relationship",
  "Family",
  "Current coworker",
  "Former colleague",
  "Recruiter",
  "Service provider",
  "Professional contact",
]);

const validRelationshipRoles = new Set<RelationshipRoleValue>([
  "Friend",
  "Mentor",
  "Mentee",
  "Advisor",
  "Sponsor",
  "Peer",
  "Collaborator",
]);

const validDispositions = new Set<PilotRelationshipDisposition>([
  "Relationship worth managing",
  "Background only",
  "Unclear",
]);

const validStates = new Set<PilotRelationshipState>([
  "Active",
  "Occasional",
  "Dormant",
  "Recently revived",
  "Unclear",
]);

const validLoopStatuses = new Set<PilotOpenLoopStatus>(["Open", "Overdue", "Unclear"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEvidenceValue<T extends string>(value: unknown, allowed: Set<T>): value is EvidenceValue<T> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.value === "string" && allowed.has(record.value as T) && isStringArray(record.evidenceIds);
}

function isEvidenceArray<T extends string>(value: unknown, allowed: Set<T>): value is EvidenceValue<T>[] {
  return Array.isArray(value) && value.every((item) => isEvidenceValue(item, allowed));
}

export function validateRelationshipInference(value: unknown): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== "object") return ["Inference must be an object."];
  const record = value as Record<string, unknown>;

  if (!isEvidenceValue(record.classification, validClassifications)) issues.push("classification is invalid.");
  if (!isEvidenceArray(record.relationshipContexts, validRelationshipContexts)) issues.push("relationshipContexts are invalid.");
  if (!isEvidenceArray(record.relationshipRoles, validRelationshipRoles)) issues.push("relationshipRoles are invalid.");
  if (!isEvidenceValue(record.disposition, validDispositions)) issues.push("disposition is invalid.");
  if (!isEvidenceValue(record.currentState, validStates)) issues.push("currentState is invalid.");

  if (!Array.isArray(record.tags)) {
    issues.push("tags must be an array.");
  } else {
    record.tags.forEach((tag, index) => {
      if (!tag || typeof tag !== "object") return issues.push(`tags[${index}] is invalid.`);
      const item = tag as Record<string, unknown>;
      if (typeof item.label !== "string" || !isStringArray(item.evidenceIds)) issues.push(`tags[${index}] is invalid.`);
    });
  }

  if (!record.history || typeof record.history !== "object") {
    issues.push("history is invalid.");
  } else {
    const history = record.history as Record<string, unknown>;
    if (typeof history.earliestObservedMeaningfulInteraction !== "string") issues.push("history earliest date is invalid.");
    if (typeof history.latestObservedMeaningfulInteraction !== "string") issues.push("history latest date is invalid.");
    if (typeof history.pattern !== "string") issues.push("history pattern is invalid.");
    if (!isStringArray(history.evidenceIds)) issues.push("history evidenceIds are invalid.");
  }

  if (!Array.isArray(record.openLoops)) {
    issues.push("openLoops must be an array.");
  } else {
    record.openLoops.forEach((loop, index) => {
      if (!loop || typeof loop !== "object") return issues.push(`openLoops[${index}] is invalid.`);
      const item = loop as Record<string, unknown>;
      if (typeof item.commitment !== "string") issues.push(`openLoops[${index}].commitment is invalid.`);
      if (typeof item.owner !== "string") issues.push(`openLoops[${index}].owner is invalid.`);
      if (typeof item.status !== "string" || !validLoopStatuses.has(item.status as PilotOpenLoopStatus)) {
        issues.push(`openLoops[${index}].status is invalid.`);
      }
      if (!isStringArray(item.evidenceIds)) issues.push(`openLoops[${index}].evidenceIds are invalid.`);
    });
  }

  if (!Array.isArray(record.reasonsToEngage)) {
    issues.push("reasonsToEngage must be an array.");
  } else {
    record.reasonsToEngage.forEach((reason, index) => {
      if (!reason || typeof reason !== "object") return issues.push(`reasonsToEngage[${index}] is invalid.`);
      const item = reason as Record<string, unknown>;
      if (typeof item.reason !== "string" || !isStringArray(item.evidenceIds)) {
        issues.push(`reasonsToEngage[${index}] is invalid.`);
      }
    });
  }

  if (!isStringArray(record.unknowns)) issues.push("unknowns must be an array of strings.");
  if (!["Low", "Moderate", "High"].includes(String(record.confidence))) issues.push("confidence is invalid.");

  return issues;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tagMetrics(expected: string[], actual: string[], aliases: Record<string, string[]> = {}) {
  const concepts = expected.map((canonical) => ({
    canonical,
    accepted: new Set([canonical, ...(aliases[canonical] ?? [])].map(normalize)),
  }));
  const actualNormalized = actual.map(normalize);
  const matchedConcepts = new Set<number>();
  let matchedActual = 0;

  for (const value of actualNormalized) {
    const index = concepts.findIndex((concept) => concept.accepted.has(value));
    if (index >= 0 && !matchedConcepts.has(index)) {
      matchedConcepts.add(index);
      matchedActual += 1;
    }
  }

  const precision = actualNormalized.length === 0
    ? (concepts.length === 0 ? 1 : 0)
    : matchedActual / actualNormalized.length;
  const recall = concepts.length === 0 ? 1 : matchedConcepts.size / concepts.length;

  return {
    precision,
    recall,
    matched: matchedConcepts.size,
    expected: concepts.length,
    actual: actualNormalized.length,
  };
}

export function evaluateRelationshipInference(
  benchmark: RelationshipBenchmarkCase,
  inference: RelationshipInference,
) {
  const threadIds = new Set(benchmark.threads.map((thread) => thread.id));
  const citedIds = [
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
  const invalidCitations = [...new Set(citedIds.filter((id) => !threadIds.has(id)))];

  const tags = tagMetrics(
    benchmark.groundTruth.tags,
    inference.tags.map((tag) => tag.label),
    benchmark.groundTruth.tagAliases,
  );
  const relationshipContexts = tagMetrics(
    benchmark.groundTruth.relationshipContexts,
    inference.relationshipContexts.map((item) => item.value),
  );
  const relationshipRoles = tagMetrics(
    benchmark.groundTruth.relationshipRoles,
    inference.relationshipRoles.map((item) => item.value),
  );

  const acceptableClassifications = new Set(
    benchmark.groundTruth.acceptableClassifications ?? [benchmark.groundTruth.classification],
  );
  const classificationAccepted = acceptableClassifications.has(inference.classification.value);

  let openLoopHardPass = true;
  if (benchmark.groundTruth.openLoopExpectation === "none") {
    openLoopHardPass = inference.openLoops.length === 0;
  } else if (benchmark.groundTruth.openLoopExpectation === "required") {
    openLoopHardPass = benchmark.groundTruth.openLoops.every((expected) =>
      inference.openLoops.some(
        (actual) =>
          normalize(actual.owner) === normalize(expected.owner) &&
          actual.status === expected.status,
      ),
    );
  }

  const hardGates = {
    classificationAccepted,
    dispositionCorrect: inference.disposition.value === benchmark.groundTruth.disposition,
    currentStateCorrect: inference.currentState.value === benchmark.groundTruth.currentState,
    earliestObservedCorrect:
      inference.history.earliestObservedMeaningfulInteraction === benchmark.groundTruth.earliestObservedMeaningfulInteraction,
    latestObservedCorrect:
      inference.history.latestObservedMeaningfulInteraction === benchmark.groundTruth.latestObservedMeaningfulInteraction,
    citationsValid: invalidCitations.length === 0,
    openLoopHardPass,
    uncertaintyPresent: inference.unknowns.length > 0,
  };

  return {
    caseId: benchmark.id,
    hardGates,
    hardGatePass: Object.values(hardGates).every(Boolean),
    softReview: {
      tags,
      relationshipContexts,
      relationshipRoles,
      expectedRelationshipContexts: benchmark.groundTruth.relationshipContexts,
      actualRelationshipContexts: inference.relationshipContexts.map((item) => item.value),
      expectedRelationshipRoles: benchmark.groundTruth.relationshipRoles,
      actualRelationshipRoles: inference.relationshipRoles.map((item) => item.value),
      expectedTags: benchmark.groundTruth.tags,
      actualTags: inference.tags.map((tag) => tag.label),
      expectedReasonsToEngage: benchmark.groundTruth.reasonsToEngage,
      actualReasonsToEngage: inference.reasonsToEngage.map((reason) => reason.reason),
      expectedOpenLoops: benchmark.groundTruth.openLoops,
      actualOpenLoops: inference.openLoops.map((loop) => ({
        commitment: loop.commitment,
        owner: loop.owner,
        status: loop.status,
      })),
      manualMustNotInferChecks: benchmark.groundTruth.mustNotInfer,
    },
    invalidCitations,
  };
}

export function groundTruthAsInference(benchmark: RelationshipBenchmarkCase): RelationshipInference {
  const allIds = benchmark.threads.map((thread) => thread.id);
  return {
    classification: { value: benchmark.groundTruth.classification, evidenceIds: allIds },
    relationshipContexts: benchmark.groundTruth.relationshipContexts.map((value) => ({ value, evidenceIds: allIds })),
    relationshipRoles: benchmark.groundTruth.relationshipRoles.map((value) => ({ value, evidenceIds: allIds })),
    disposition: { value: benchmark.groundTruth.disposition, evidenceIds: allIds },
    currentState: { value: benchmark.groundTruth.currentState, evidenceIds: allIds },
    tags: benchmark.groundTruth.tags.map((label) => ({ label, evidenceIds: allIds })),
    history: {
      earliestObservedMeaningfulInteraction: benchmark.groundTruth.earliestObservedMeaningfulInteraction,
      latestObservedMeaningfulInteraction: benchmark.groundTruth.latestObservedMeaningfulInteraction,
      pattern: "Ground-truth helper used only by tests.",
      evidenceIds: allIds,
    },
    openLoops: benchmark.groundTruth.openLoops.map((loop) => ({ ...loop, evidenceIds: allIds })),
    reasonsToEngage: benchmark.groundTruth.reasonsToEngage.map((reason) => ({ reason, evidenceIds: allIds })),
    unknowns: benchmark.groundTruth.unknowns,
    confidence: "Moderate",
  };
}
