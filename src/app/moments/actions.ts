"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { reviewPeopleForMoment } from "@/lib/moment-people";
import {
  getPersonalMoment,
  listRelationships,
  savePersonalMoment,
} from "@/lib/relationship-store";

function ensureDevelopment() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Personal moment persistence is only available in local development.");
  }
}

export async function saveUserMoment(formData: FormData) {
  ensureDevelopment();
  const description = String(formData.get("description") ?? "");
  const reflection = String(formData.get("reflection") ?? "");
  const url = String(formData.get("url") ?? "");
  const consideration = formData.get("consider") === "on" ? "consider-people" : "private";
  const moment = await savePersonalMoment({ description, reflection, url, consideration });
  revalidatePath("/moments");
  redirect("/moments?saved=" + encodeURIComponent(moment.id));
}

/** Private, explicitly requested, read-only matching. Never sends messages. */
export async function reviewUserMoment(momentId: string) {
  ensureDevelopment();
  const moment = await getPersonalMoment(momentId);
  if (!moment) throw new Error("Saved moment not found.");
  const people = moment.consideration === "consider-people" ? await listRelationships() : [];
  const timeZone = process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver";
  const reviewedAt = new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return reviewPeopleForMoment(moment, people, {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_RELATIONSHIP_MODEL,
    reviewedAt,
  });
}
