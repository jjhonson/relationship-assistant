import Link from "next/link";
import { createManualRelationship } from "./actions";
import { listRecentCaptures, listRelationships } from "@/lib/relationship-store";
import { relationshipContactDetails, relationshipContextLabel, lastContactDescription } from "@/lib/relationship-overview";
import RelationshipDirectory from "./RelationshipDirectory";
import { captureLocalDay, localCaptureEvidence } from "@/lib/capture-calendar";

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
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const people = relationships.map((relationship) => {
    const fields = relationshipContactDetails(localCaptureEvidence(relationship,recentCaptures), today);
    const title = fields.find((field) => field.label === "Title")?.value;
    const company = fields.find((field) => field.label === "Company")?.value;
    const context = relationshipContextLabel(relationship, today);
    const detail = [title, company].filter(Boolean).join(" · ") || (context ? context.value + (context.inferred ? " (suggested)" : "") : "");
    const lastContact = lastContactDescription(relationship, today);
    return { id: relationship.id, label: relationship.personLabel, detail,
      lastContact: lastContact.elapsed ? "Last contact " + lastContact.elapsed.toLowerCase() : "" };
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl">Relationships</h1>
        <Link href="/" className="text-sm font-medium text-stone-700 underline-offset-4 hover:underline">Remember something</Link>
      </div>
      <RelationshipDirectory people={people} />
      <details className="rounded-xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-stone-600">Other tools</summary>
        <div className="mt-4 space-y-5">
      {recentCaptures.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Recently remembered</h2>
          <ul className="mt-3 space-y-2">
            {recentCaptures.map((capture) => (
              <li key={capture.id}>
                <Link href={"/captures/" + capture.id} className="block rounded-xl border border-stone-200 bg-white p-4 hover:border-indigo-300">
                  <span className="text-xs text-stone-500">{captureLocalDay(capture.capturedAt)}</span>
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
        <p className="mt-2 text-sm text-stone-600">Optional way to add a person without writing a memory first.</p>
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

          <Link href="/discover" className="inline-block text-sm font-medium text-stone-700 underline-offset-4 hover:underline">Find people from Gmail</Link>
        </div>
      </details>
    </div>
  );
}
