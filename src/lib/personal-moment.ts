import { randomUUID } from "node:crypto";

/**
 * A deliberately saved piece of the user's own life. This is not inferred from
 * reading history, and saving it does not mean the user endorses or recommends it.
 */
export type PersonalMoment = {
  id: string;
  createdAt: string;
  description: string;
  reflection: string;
  url: string;
  // Explicitly opt in to a private, on-demand matching review. Never means send.
  consideration: "private" | "consider-people";
};

export type PersonalMomentInput = {
  description: string;
  reflection?: string;
  url?: string;
  consideration?: PersonalMoment["consideration"];
};

export function createPersonalMoment(
  input: PersonalMomentInput,
  now = new Date(),
): PersonalMoment {
  const description = String(input.description ?? "").trim();
  const reflection = String(input.reflection ?? "").trim();
  const url = String(input.url ?? "").trim();

  if (!description || description.length > 3000) {
    throw new Error("Describe what you want to remember (up to 3,000 characters).");
  }
  if (reflection.length > 2000) {
    throw new Error("Your thoughts must be 2,000 characters or fewer.");
  }
  if (url.length > 2048) {
    throw new Error("Link is too long.");
  }
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Link must be a valid https:// or http:// address.");
    }
    if (!["https:", "http:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error("Link must be a valid https:// or http:// address without embedded credentials.");
    }
  }

  const consideration = input.consideration ?? "private";
  if (consideration !== "private" && consideration !== "consider-people") {
    throw new Error("Invalid moment consideration choice.");
  }
  return {
    id: randomUUID(),
    createdAt: now.toISOString(),
    description,
    reflection,
    url,
    consideration,
  };
}
