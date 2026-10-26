export interface HistoryEntry {
  date: string; // ISO date
  title: string;
  note: string;
}

export interface PlanStep {
  cadence: string;
  action: string;
}

export interface Contact {
  id: string;
  name: string;
  relationship: string;
  lastInteraction: string; // ISO date of last meaningful interaction
  history: HistoryEntry[];
  importantContext: string[];
  recentDevelopments: string[];
  suggestedActions: string[];
  plan: { goal: string; steps: PlanStep[] };
}
