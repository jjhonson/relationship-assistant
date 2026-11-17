import Link from "next/link";
import { createManualRelationship } from "./actions";
import QuickCaptureForm from "@/components/QuickCaptureForm";
import { listRecentCaptures, listRelationships } from "@/lib/relationship-store";

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
  const [relationships, recentCaptures] = await Promise.all([listRelationships(), listRecentCaptures()]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          Relationship memory
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Relationship memory</h1>
        <p className="mt-2 max-w-3xl text-stone-600">
          Remember the people and moments that matter. A short note can start a new relationship
          or add to one you already know. Call transcripts are handled separately and are not retained.
        </p>
      </div>

      <QuickCaptureForm />

      {recentCaptures.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Recently remembered</h2>
          <ul className="mt-3 space-y-2">
            {recentCaptures.map((capture) => (
              <li key={capture.id}>
                <Link href={"/captures/" + capture.id} className="block rounded-xl border border-stone-200 bg-white p-4 hover:border-indigo-300">
                  <span className="text-xs text-stone-500">{capture.capturedAt.slice(0, 10)}</span>
                  <p className="mt-1 text-sm font-medium text-stone-900">
                    {capture.summary || capture.note.slice(0, 180)}
                  </p>
                  <span className="text-xs text-indigo-700">
                    {capture.status === "pending" ? "Saved, awaiting interpretation" :
                      capture.people.some((person) => person.resolution === "needs-review") ? "Some identities need review" : "View saved memory"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-2xl border border-stone-200 bg-white p-6">
        <summary className="cursor-pointer text-sm font-medium text-indigo-700">Or create a record using fields</summary>
        <p className="mt-2 text-sm text-stone-600">Optional legacy form. Quick capture above needs none of these fields.</p>
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
      </details>

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
                      <p className="mt-2 text-xs font-medium text-indigo-700">
                        {relationship.intention?.mode ?? "Intention not set"}
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
