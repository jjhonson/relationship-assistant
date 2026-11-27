"use server";

import { requirePrivateAlphaRuntime } from "@/lib/private-alpha-runtime";
import { parseCadencePreference } from "@/lib/relationship-cadence";
import { saveRelationshipCadence } from "@/lib/relationship-store";
import { revalidatePath } from "next/cache";

export async function updateContactCadence(personId: string, form: FormData) {
  requirePrivateAlphaRuntime();
  const days = parseCadencePreference(form.get("contactCadence"));
  await saveRelationshipCadence(personId, days);
  revalidatePath("/");
  revalidatePath("/relationships");
  revalidatePath("/relationships/" + personId);
}
