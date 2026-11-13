import Link from "next/link";
import { createManualRelationship } from "./actions";
import { listRelationships } from "@/lib/relationship-store";

export const dynamic = "force-dynamic";

const contextOptions = [
  "",
  "Personal relationship",
  "Family",
  "Current coworker",
  "Former colleague",
  "Recruiter",
  "Service provider",
  "Professional contact",
];

const roleOptions = [
  "",
  "Friend",
  "Mentor",
  "Mentee",
  "Advisor",
  "Sponsor",
  "Peer",
  "Collaborator",
];

export default async function RelationshipsPage() {
  const relationships = await listRelationships();

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          Relationship memory
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Relationship memory</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          Confirm a small set of relationships, then let new interactions make each record more useful.
          This prototype stores structured relationship memory locally and does not retain raw transcript text.
        </p>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Add a relationship manually</h2>
        <p className="mt-1 text-sm text-stone-600">
          Use this when someone is not available through Gmail onboarding yet.
        </p>
        <form action={createManualRelationship} className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium text-stone-700">
            Name
            <input
              name="personLabel"
              required
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
              placeholder="Matthew Strongin"
            />
          </label>
          <label className="text-sm font-medium text-stone-700">
            Known context
            <select
              name="context"
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
            >
              {contextOptions.map((option) => (
                <option key={option || "none"} value={option}>
                  {option || "Not specified"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-stone-700">
            Known role
            <select
              name="role"
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
            >
              {roleOptions.map((option) => (
                <option key={option || "none"} value={option}>
                  {option || "Not specified"}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800"
            >
              Create relationship
            </button>
          </div>
        </form>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Saved relationships</h2>
            <p className="mt-1 text-sm text-stone-600">
              {relationships.length === 0
                ? "None yet."
                : relationships.length + " relationship" + (relationships.length === 1 ? "" : "s") + " saved."}
            </p>
          </div>
          <Link href="/discover" className="text-sm font-medium text-indigo-700 hover:underline">
            Find people from Gmail →
          </Link>
        </div>

        {relationships.length > 0 && (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {relationships.map((relationship) => (
              <li key={relationship.id}>
                <Link
                  href={"/relationships/" + relationship.id}
                  className="block rounded-2xl border border-stone-200 bg-white p-5 shadow-sm hover:border-indigo-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-stone-900">{relationship.personLabel}</h3>
                      <p className="mt-1 text-sm text-stone-600">
                        {relationship.relationshipContexts.length > 0
                          ? relationship.relationshipContexts.join(" · ")
                          : "No user-confirmed context yet"}
                        {relationship.labelAuthority !== "user-confirmed" && (
                          <span className="ml-2 text-xs text-amber-700">
                            {relationship.labelAuthority === "inferred-only" ? "AI analysis only" : "Previously saved; review needed"}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
                      {relationship.currentState}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-stone-600">
                    <div className="rounded-lg bg-stone-50 px-2 py-2">
                      <strong className="block text-base text-stone-900">
                        {relationship.durableFacts.length}
                      </strong>
                      facts
                    </div>
                    <div className="rounded-lg bg-stone-50 px-2 py-2">
                      <strong className="block text-base text-stone-900">
                        {relationship.activeThreads.length}
                      </strong>
                      active threads
                    </div>
                    <div className="rounded-lg bg-stone-50 px-2 py-2">
                      <strong className="block text-base text-stone-900">
                        {relationship.stewardshipOpportunities.length}
                      </strong>
                      opportunities
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
