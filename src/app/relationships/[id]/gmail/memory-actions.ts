"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePrivateAlphaRuntime } from "@/lib/private-alpha-runtime";
import { getDatasetMode } from "../../../../../scripts/dataset-profile.mjs";
import { PERSONAL_GMAIL_ORIGIN, validPersonGmailId } from "@/lib/gmail/personal-session";
import { removePersonGmailSources } from "@/lib/relationship-store";

export async function removeSelectedGmailMemory(personId: string, sourceIds: string[], reviewVersion: string, confirmed: boolean) {
  if (confirmed !== true) return { kind: "error" as const, message: "Confirm exactly which imported memory to remove." };
  try {
    requirePrivateAlphaRuntime();
    if (getDatasetMode() !== "personal" || !validPersonGmailId(personId) ||
        (await headers()).get("origin") !== PERSONAL_GMAIL_ORIGIN) {
      return { kind: "error" as const, message: "Removal is available only in the private personal alpha." };
    }
  } catch {
    return { kind: "error" as const, message: "Removal is available only in the private personal alpha." };
  }
  try {
    const result = await removePersonGmailSources(personId, sourceIds, reviewVersion);
    revalidatePath("/relationships/" + encodeURIComponent(personId));
    revalidatePath("/relationships");
    revalidatePath("/");
    return { kind: "removed" as const, ...result };
  } catch {
    // A lost response may have followed a committed write. Do not claim
    // nothing was removed. Reload for an accurate source review.
    return { kind: "error" as const, message: "Removal could not be confirmed. Refresh and review saved memory before trying again." };
  }
}
