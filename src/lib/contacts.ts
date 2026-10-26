import type { Contact } from "./types";

// All data below is fictional.
export const contacts: Contact[] = [
  {
    id: "maya-chen",
    name: "Maya Chen",
    relationship: "College roommate and close friend",
    lastInteraction: "2026-08-14",
    history: [
      { date: "2018-09-01", title: "Became roommates", note: "Shared a dorm and stayed up late planning a student radio show." },
      { date: "2022-06-18", title: "Cross-country move", note: "Helped Maya pack when she moved to Portland." },
      { date: "2026-08-14", title: "Long phone call", note: "Talked for two hours about career doubts and a possible move." },
    ],
    importantContext: [
      "Values honesty over reassurance.",
      "Her mother's health has been a worry for the past year.",
      "Loves hiking and small-batch coffee.",
    ],
    recentDevelopments: [
      "Considering leaving her design agency to freelance.",
      "Her sister's wedding is in November.",
    ],
    suggestedActions: [
      "Send a note asking how the freelance decision is shaping up.",
      "Share the trail guide you mentioned for the Columbia Gorge.",
      "Offer to help with wedding trip logistics.",
    ],
    plan: {
      goal: "Keep a close friendship alive despite distance.",
      steps: [
        { cadence: "Every 2 weeks", action: "Quick voice message or check-in text" },
        { cadence: "Monthly", action: "Scheduled call, 45+ minutes" },
        { cadence: "Yearly", action: "Plan an in-person trip together" },
      ],
    },
  },
  {
    id: "david-okafor",
    name: "David Okafor",
    relationship: "Former manager and mentor",
    lastInteraction: "2026-03-02",
    history: [
      { date: "2019-04-10", title: "Hired onto his team", note: "David took a chance on a junior analyst." },
      { date: "2021-11-05", title: "Promotion advocacy", note: "He championed your promotion to senior analyst." },
      { date: "2026-03-02", title: "Mentorship lunch", note: "Discussed leadership paths over lunch." },
    ],
    importantContext: [
      "Prefers concise, well-prepared questions.",
      "Mentors several people; appreciates hearing outcomes.",
      "Enjoys long-distance running.",
    ],
    recentDevelopments: [
      "Recently became VP of Operations.",
      "Training for a fall marathon.",
    ],
    suggestedActions: [
      "Congratulate him on the VP role and share how his advice helped you.",
      "Ask for one book recommendation on leading teams.",
      "Wish him luck on his marathon.",
    ],
    plan: {
      goal: "Sustain a mutual, respectful mentorship.",
      steps: [
        { cadence: "Quarterly", action: "Share a short progress update and a specific question" },
        { cadence: "Twice a year", action: "Meet for lunch or coffee" },
        { cadence: "As it happens", action: "Thank him when his advice pays off" },
      ],
    },
  },
  {
    id: "priya-raman",
    name: "Priya Raman",
    relationship: "Sister-in-law",
    lastInteraction: "2026-09-21",
    history: [
      { date: "2020-05-23", title: "Family wedding", note: "Bonded over shared love of terrible karaoke." },
      { date: "2024-12-26", title: "Holiday cooking day", note: "Cooked a full dinner together for the family." },
      { date: "2026-09-21", title: "Birthday dinner", note: "Celebrated her 35th with a small gathering." },
    ],
    importantContext: [
      "Vegetarian; loves trying new recipes.",
      "She and her husband are expecting their first child.",
      "Prefers texts to phone calls.",
    ],
    recentDevelopments: [
      "Baby due in January.",
      "Started a part-time pottery class.",
    ],
    suggestedActions: [
      "Offer to cook and deliver meals before the baby arrives.",
      "Ask to see her latest pottery piece.",
      "Plan a low-key visit after the birth.",
    ],
    plan: {
      goal: "Deepen a warm family bond through the new-baby season.",
      steps: [
        { cadence: "Weekly", action: "Light check-in text" },
        { cadence: "Monthly", action: "Cook or share a meal together" },
        { cadence: "January", action: "Welcome-baby gift and visit" },
      ],
    },
  },
  {
    id: "marcus-bell",
    name: "Marcus Bell",
    relationship: "Former colleague and collaborator",
    lastInteraction: "2025-11-12",
    history: [
      { date: "2020-02-03", title: "Co-led a product launch", note: "Worked side by side through a tight deadline." },
      { date: "2023-07-14", title: "Farewell lunch", note: "Marcus left to join a startup." },
      { date: "2025-11-12", title: "Conference reunion", note: "Caught up briefly and promised to talk more." },
    ],
    importantContext: [
      "Dry sense of humor; enjoys board games.",
      "Cares about building ethical products.",
      "Easy to lose touch with; always happy to reconnect.",
    ],
    recentDevelopments: [
      "His startup just closed a seed round.",
      "Recently posted about hiring engineers.",
    ],
    suggestedActions: [
      "Reach out to congratulate him and ask about the seed round.",
      "Suggest a board game evening or video call.",
      "Introduce him to a contact who might help with hiring.",
    ],
    plan: {
      goal: "Reconnect after a long gap and keep a lasting professional friendship.",
      steps: [
        { cadence: "This week", action: "Send a warm reconnect message" },
        { cadence: "Quarterly", action: "Catch-up call" },
        { cadence: "When relevant", action: "Share useful articles or introductions" },
      ],
    },
  },
  {
    id: "eleanor-wright",
    name: "Eleanor Wright",
    relationship: "Neighbor and longtime family friend",
    lastInteraction: "2026-06-05",
    history: [
      { date: "2015-03-12", title: "Welcomed you to the street", note: "Brought over fresh bread on moving day." },
      { date: "2023-01-20", title: "Snow-day help", note: "You shoveled her driveway; she brought soup." },
      { date: "2026-06-05", title: "Garden afternoon", note: "Spent an afternoon in her garden swapping stories." },
    ],
    importantContext: [
      "Retired schoolteacher in her late 70s.",
      "Lives alone; her son visits a few times a year.",
      "Treasures handwritten notes.",
    ],
    recentDevelopments: [
      "Had a minor knee surgery in September.",
      "Her tomato harvest was exceptional this year.",
    ],
    suggestedActions: [
      "Drop off a handwritten card and a homemade treat.",
      "Offer to help with errands while she recovers.",
      "Ask her to share gardening tips this spring.",
    ],
    plan: {
      goal: "Be a dependable, friendly presence nearby.",
      steps: [
        { cadence: "Weekly", action: "Quick doorstep hello or wave" },
        { cadence: "Monthly", action: "Share a meal or tea" },
        { cadence: "Seasonally", action: "Offer help with yard work" },
      ],
    },
  },
];

export function getContacts(): Contact[] {
  return contacts;
}

export function getContact(id: string): Contact | undefined {
  return contacts.find((c) => c.id === id);
}
