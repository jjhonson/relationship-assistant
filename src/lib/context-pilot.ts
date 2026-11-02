export type PilotClassification =
  | "Friend or family"
  | "Recruiter"
  | "Coworker"
  | "Service provider"
  | "Professional contact"
  | "Unknown";

export type PilotRecommendation =
  | "No action needed"
  | "Research more"
  | "Worthwhile reconnection"
  | "User judgment needed";

export type PilotCorrections = {
  classification?: PilotClassification;
  recommendation?: PilotRecommendation;
};

export type PilotThread = {
  id: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  body: string;
};

export type PilotContact = {
  id: string;
  label: string;
  scenario: string;
  classification: PilotClassification;
  classificationEvidence: string;
  classificationSources: string[];
  confidence: "Low" | "Moderate";
  significance: string;
  significanceSources: string[];
  maintenance: string;
  maintenanceSources: string[];
  recommendation: PilotRecommendation;
  recommendationReason: string;
  unknowns: string[];
  threads: PilotThread[];
};

export const MAX_PILOT_THREADS = 3;

export const pilotContacts: PilotContact[] = [
  {
    id: "frequent-family",
    label: "Taylor Kim",
    scenario: "High-significance person with frequent contact",
    classification: "Friend or family",
    classificationEvidence: "The messages refer to family gatherings and mutual emotional support.",
    classificationSources: ["family-1", "family-3"],
    confidence: "Moderate",
    significance: "Several exchanges describe ongoing mutual support and time together, not just logistics.",
    significanceSources: ["family-1", "family-2"],
    maintenance: "Recent, reciprocal email contact is visible; other channels are not represented.",
    maintenanceSources: ["family-2", "family-3"],
    recommendation: "No action needed",
    recommendationReason: "The fictional evidence shows an actively maintained relationship; a reminder would add little.",
    unknowns: ["The sample cannot establish the full relationship or the user's preferred contact cadence."],
    threads: [
      { id: "family-1", date: "2026-04-12", from: "Taylor Kim", to: "You", subject: "Sunday lunch", body: "Thanks for making time to talk through the move. It helped to hear your perspective. Let's do lunch again soon." },
      { id: "family-2", date: "2026-07-06", from: "You", to: "Taylor Kim", subject: "Checking in", body: "I appreciated your call last week. I'm glad we could catch up, and I'm here if you want to talk more." },
      { id: "family-3", date: "2026-10-02", from: "Taylor Kim", to: "You", subject: "Family plans", body: "Looking forward to seeing everyone next weekend. Thanks for helping coordinate." },
    ],
  },
  {
    id: "lodging-host",
    label: "Casey Lane",
    scenario: "One-time vacation lodging host",
    classification: "Service provider",
    classificationEvidence: "The only supplied messages concern a reservation and check-in details.",
    classificationSources: ["stay-1", "stay-2"],
    confidence: "Low",
    significance: "The correspondence supports a completed transaction, not broader personal significance.",
    significanceSources: ["stay-1", "stay-2"],
    maintenance: "A brief email exchange occurred around one stay; contact outside email is unknown.",
    maintenanceSources: ["stay-1", "stay-2"],
    recommendation: "No action needed",
    recommendationReason: "Nothing in this sample suggests an ongoing relationship or a reason to reconnect.",
    unknowns: ["A short transactional exchange says little about either person's importance or other contact channels."],
    threads: [
      { id: "stay-1", date: "2026-05-14", from: "You", to: "Casey Lane", subject: "Arrival time", body: "Our train arrives around 4 p.m. Is that a workable check-in time?" },
      { id: "stay-2", date: "2026-05-14", from: "Casey Lane", to: "You", subject: "Re: Arrival time", body: "That works. The key box is beside the front door; enjoy your stay." },
    ],
  },
  {
    id: "recruiter",
    label: "Morgan Reed",
    scenario: "Recruiter with a brief, potentially meaningful exchange",
    classification: "Recruiter",
    classificationEvidence: "The messages discuss an introductory call and a role description.",
    classificationSources: ["recruiter-1", "recruiter-2"],
    confidence: "Low",
    significance: "The exchange may matter professionally, but the sample does not show whether an opportunity progressed.",
    significanceSources: ["recruiter-1", "recruiter-2"],
    maintenance: "A short burst of email is visible; no later email is included.",
    maintenanceSources: ["recruiter-1", "recruiter-2"],
    recommendation: "Research more",
    recommendationReason: "Check whether the role or conversation remains relevant before deciding to reconnect.",
    unknowns: ["The sample does not establish the outcome, the user's interest, or contact through another channel."],
    threads: [
      { id: "recruiter-1", date: "2026-08-03", from: "Morgan Reed", to: "You", subject: "Introductory call", body: "Would you be available for a short conversation about a product role next week?" },
      { id: "recruiter-2", date: "2026-08-05", from: "You", to: "Morgan Reed", subject: "Re: Introductory call", body: "Thanks for reaching out. I can make time Thursday; please send the role description." },
    ],
  },
  {
    id: "new-coworker",
    label: "Jamie Patel",
    scenario: "New coworker with an onboarding email burst",
    classification: "Coworker",
    classificationEvidence: "The messages refer to team onboarding, a project handoff, and a shared meeting.",
    classificationSources: ["coworker-1", "coworker-2", "coworker-3"],
    confidence: "Low",
    significance: "There is evidence of a working connection, but not enough to infer personal importance from onboarding mail.",
    significanceSources: ["coworker-1", "coworker-2"],
    maintenance: "Several messages cluster around onboarding; later email activity is not shown.",
    maintenanceSources: ["coworker-1", "coworker-3"],
    recommendation: "User judgment needed",
    recommendationReason: "The user is best placed to decide whether the working connection merits a follow-up.",
    unknowns: ["Work chat or in-person contact may continue even if email becomes quiet."],
    threads: [
      { id: "coworker-1", date: "2026-09-08", from: "Jamie Patel", to: "You", subject: "Welcome to the team", body: "Happy to help with onboarding. Here are the project notes we mentioned." },
      { id: "coworker-2", date: "2026-09-10", from: "You", to: "Jamie Patel", subject: "Project handoff", body: "Thanks for walking me through the handoff. I added my questions to the shared notes." },
      { id: "coworker-3", date: "2026-09-12", from: "Jamie Patel", to: "You", subject: "Team sync", body: "Good meeting today. Let's compare notes after we have both tried the new workflow." },
    ],
  },
  {
    id: "dormant-professional",
    label: "Drew Foster",
    scenario: "Dormant but historically significant professional contact",
    classification: "Professional contact",
    classificationEvidence: "The messages describe collaboration over several years and thoughtful career guidance.",
    classificationSources: ["dormant-1", "dormant-2", "dormant-3"],
    confidence: "Moderate",
    significance: "Sparse email spans years and describes meaningful collaboration and support; volume understates that context.",
    significanceSources: ["dormant-1", "dormant-2"],
    maintenance: "No recent email is included. This is an email-only observation, not proof the relationship is inactive.",
    maintenanceSources: ["dormant-1", "dormant-2", "dormant-3"],
    recommendation: "Worthwhile reconnection",
    recommendationReason: "If the relationship still matters to the user, a low-pressure check-in could be worthwhile after verifying current context.",
    unknowns: ["The sample cannot show whether you are in touch by phone, in person, or another channel."],
    threads: [
      { id: "dormant-1", date: "2019-03-19", from: "Drew Foster", to: "You", subject: "Project launch", body: "It was a privilege to work through that launch together. Your careful planning made a difference." },
      { id: "dormant-2", date: "2021-11-02", from: "You", to: "Drew Foster", subject: "Thank you", body: "Your advice helped me think through the next step. I wanted you to know how much I appreciated it." },
      { id: "dormant-3", date: "2023-06-17", from: "Drew Foster", to: "You", subject: "Career update", body: "Congratulations on the new direction. I'm glad our conversations were useful, and I hope things are going well." },
    ],
  },
];

export function getPilotContact(id: string) {
  return pilotContacts.find((contact) => contact.id === id);
}

export function canReviewPilotContact(contactId: string, consentGranted: boolean) {
  return Boolean(contactId && consentGranted && getPilotContact(contactId));
}

export function buildPilotBrief(contactId: string, consentGranted: boolean) {
  if (!canReviewPilotContact(contactId, consentGranted)) return undefined;
  const contact = getPilotContact(contactId);
  if (!contact) return undefined;
  return { ...contact, threads: contact.threads.slice(0, MAX_PILOT_THREADS) };
}

export function getEffectivePilotInterpretation(
  brief: Pick<PilotContact, "classification" | "recommendation">,
  corrections: PilotCorrections = {},
) {
  return {
    suggestedClassification: brief.classification,
    effectiveClassification: corrections.classification ?? brief.classification,
    suggestedRecommendation: brief.recommendation,
    effectiveRecommendation: corrections.recommendation ?? brief.recommendation,
  };
}
