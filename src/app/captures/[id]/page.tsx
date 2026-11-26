import Link from "next/link";
import { notFound } from "next/navigation";
import { linkCapturedPerson, retryQuickCapture } from "@/app/relationships/capture-actions";
import { getCapture, listRelationships } from "@/lib/relationship-store";

export const dynamic = "force-dynamic";

export default async function SavedCapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const capture = await getCapture(id);
  if (!capture) notFound();
  const relationships = await listRelationships();
  const namesById = new Map(relationships.map((item) => [item.id, item.personLabel]));
  const retryAction = retryQuickCapture.bind(null, id);
  const resolveAction = linkCapturedPerson.bind(null, id);

  return (
    <div className="space-y-6">
      <Link href="/relationships" className="text-sm font-medium text-indigo-700 hover:underline">
        ← People
      </Link>
      <header className="rounded-2xl border border-stone-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Saved memory</p>
        <h1 className="mt-1 text-2xl font-bold text-stone-900">
          {capture.summary || "A note you wanted to remember"}
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          {capture.source === "user-image" ? "Photo selected" : "Note recorded"} {capture.capturedAt.slice(0, 10)}
          {capture.source === "user-image" ? " (not necessarily the date of the event)" : ""}
        </p>
        {capture.note && (
          <div className="mt-5 rounded-xl bg-stone-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {capture.source === "user-image" ? "Context you added" : "What you wrote"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-stone-800">{capture.note}</p>
          </div>
        )}
        {capture.source === "user-image" && (
          <div className="mt-5 space-y-3">
            {capture.sourceText && (
              <div className="rounded-xl bg-stone-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Text read from photo</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-stone-800">{capture.sourceText}</p>
              </div>
            )}
            {capture.visualDetails && (
              <div className="rounded-xl bg-stone-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Visible details</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-stone-800">{capture.visualDetails}</p>
              </div>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-stone-500">
          {capture.source === "user-image"
            ? "The original image was not retained. Text and visual details were extracted by AI and may be inaccurate; check them before relying on them."
            : "Your words are saved with this memory. Unknown details stay unknown, and you can return to the original note."}
        </p>
      </header>

      {capture.status === "pending" ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-950">Saved, but not yet interpreted</h2>
          <p className="mt-2 text-sm text-amber-900">
            {capture.source === "user-image"
              ? "The extracted text and observations are saved, but the relationship interpretation is pending. You can retry using those saved details; the image itself was not retained."
              : "The note is safe. Interpretation may be unavailable because the model is not configured or its response failed validation. You can retry after checking the local model setup."}
          </p>
          <form action={retryAction} className="mt-4">
            <button type="submit" className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-950">
              Retry interpretation
            </button>
          </form>
          {capture.contextRelationshipId && (
            <Link href={"/relationships/" + capture.contextRelationshipId} className="mt-3 block text-sm font-medium text-indigo-700 hover:underline">
              Back to {namesById.get(capture.contextRelationshipId) || "relationship"}
            </Link>
          )}
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-stone-200 bg-white p-6">
            <h2 className="text-lg font-semibold">People in this memory</h2>
            {capture.people.length === 0 && (
              <p className="mt-2 text-sm text-stone-600">
                No person could be identified confidently. The note remains searchable here for later clarification.
              </p>
            )}
            <ul className="mt-3 space-y-3">
              {capture.people.map((person, index) => (
                <li key={index} className="rounded-xl border border-stone-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-stone-900">{person.name}</h3>
                    <span className="text-xs text-stone-500">
                      {person.resolution === "created" ? "New provisional record" :
                        person.resolution === "linked" ? "Linked to known person" : "Identity needs a choice"}
                    </span>
                  </div>
                  {person.relationshipId ? (
                    <Link href={"/relationships/" + person.relationshipId} className="mt-2 inline-block text-sm font-medium text-indigo-700 hover:underline">
                      Open {namesById.get(person.relationshipId) || person.name}&apos;s record →
                    </Link>
                  ) : (
                    <div className="mt-3">
                      <p className="text-sm text-stone-600">
                        A person with a similar name may already exist. Nothing has been merged or duplicated.
                      </p>
                      <form action={resolveAction} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="personIndex" value={index} />
                        <label className="text-sm text-stone-700">
                          Who is this?
                          <select name="relationshipId" required defaultValue="" className="mt-1 block rounded-lg border border-stone-300 bg-white px-3 py-2">
                            <option value="" disabled>Choose a person</option>
                            {person.candidateIds.map((candidateId) => (
                              <option key={candidateId} value={candidateId}>{namesById.get(candidateId) ?? "Saved person"}</option>
                            ))}
                            <option value="new">Someone new (create separate record)</option>
                          </select>
                        </label>
                        <button type="submit" className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white">Resolve</button>
                      </form>
                    </div>
                  )}
                  {[person.company, person.jobTitle, person.city].some(Boolean) && (
                    <p className="mt-3 text-sm text-stone-600">
                      {[person.jobTitle, person.company, person.city].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {capture.contextRelationshipId && !capture.people.some((item) => item.relationshipId === capture.contextRelationshipId) && (
              <p className="mt-4 text-sm text-stone-600">
                Also filed under <Link href={"/relationships/" + capture.contextRelationshipId} className="font-medium text-indigo-700 hover:underline">
                  {namesById.get(capture.contextRelationshipId) || "the originating relationship"}
                </Link> because that is where you saved it.
              </p>
            )}
          </section>

          {(capture.sharedDetails.length > 0 || (capture.connections ?? []).length > 0 ||
            capture.otherPeople.length > 0 || capture.commitments.length > 0) && (
            <section className="rounded-2xl border border-stone-200 bg-white p-6">
              <h2 className="text-lg font-semibold">Other things remembered</h2>
              {capture.sharedDetails.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700">
                  {capture.sharedDetails.map((detail, index) => <li key={index}>{detail}</li>)}
                </ul>
              )}
              {(capture.connections ?? []).length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-stone-700">Connections suggested by this memory</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                    {(capture.connections ?? []).map((link) => (
                      <li key={link.id}>
                        {link.firstName} and {link.secondName}: {link.description}
                        {link.dismissed ? " (dismissed)" : link.firstRelationshipId && link.secondRelationshipId
                          ? " (inferred, not confirmed)" : " (context only, not linked to two saved people)"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {capture.otherPeople.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-stone-700">People mentioned (not created as contacts)</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-stone-700">
                    {capture.otherPeople.map((other, index) => <li key={index}>{other.name}: {other.connection}</li>)}
                  </ul>
                </div>
              )}
              {capture.commitments.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-stone-700">Explicit commitments mentioned</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-stone-700">
                    {capture.commitments.map((commitment, index) => <li key={index}>{commitment.owner}: {commitment.description}</li>)}
                  </ul>
                  <p className="mt-1 text-xs text-stone-500">These are remembered facts, not automatically created reminders.</p>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
