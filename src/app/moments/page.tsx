import Link from "next/link";
import { changeMomentConsideration, saveUserMoment } from "./actions";
import MomentPeopleReview from "./MomentPeopleReview";
import { listPersonalMoments } from "@/lib/relationship-store";

export const dynamic = "force-dynamic";

export default async function MomentsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; updated?: string }>;
}) {
  const [moments, params] = await Promise.all([listPersonalMoments(), searchParams]);

  return (
    <div className="space-y-7">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Your side of the story</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">Moments worth remembering</h1>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Save an interesting experience, idea, conversation, article or something you noticed.
          An item is not automatically a recommendation. What mattered to you may be very different
          from the thing itself.
        </p>
        <Link href="/relationships" className="mt-2 inline-block text-sm font-medium text-indigo-700 hover:underline">
          Explore your people →
        </Link>
      </header>

      <section className="rounded-2xl border border-indigo-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Save a moment</h2>
        <p className="mt-1 text-sm text-stone-600">
          A few words are enough. Your original wording stays private in the local prototype.
          Adding a link does not cause the app to fetch or read it.
        </p>
        <form action={saveUserMoment} className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-stone-800">
            What do you want to remember?
            <textarea name="description" required maxLength={3000} rows={5}
              placeholder="I found a helpful guitar exercise and liked the simple explanation… or: I disliked a documentary, but it raised interesting questions about learning."
              className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
          </label>
          <p className="text-xs text-stone-500">
            Include what happened and what you thought, liked, disliked or questioned in one note.
            Saving something does not mean you recommend it.
          </p>
          <label className="block text-sm font-medium text-stone-800">
            Link <span className="font-normal text-stone-500">(optional, http/https only)</span>
            <input name="url" type="url" maxLength={2048} placeholder="https://example.org/..."
              className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input name="consider" type="checkbox" className="mt-1" />
            <span>
              <strong>Consider this when finding meaningful one-to-one connections.</strong>
              <span className="block text-xs text-stone-500">
                Unchecked means keep it private for now. Checking only enables an optional review;
                no AI analysis or outreach happens until you request it.
              </span>
            </span>
          </label>
          <button type="submit"
            className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800">
            Save moment
          </button>
        </form>
      </section>

      <section>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-stone-900">Your saved moments</h2>
            <p className="mt-1 text-sm text-stone-600">
              {moments.length} saved. You can keep a moment without connecting it to anyone.
            </p>
          </div>
        </div>
        {moments.length === 0 && (
          <p className="mt-3 rounded-xl bg-stone-50 p-5 text-sm text-stone-600">
            Nothing saved yet. Start with any small real-world moment; no person or contact detail is required.
          </p>
        )}
        {moments.length > 0 && (
          <ol className="mt-4 space-y-4">
            {moments.map((moment) => (
              <li key={moment.id} className="rounded-2xl border border-stone-200 bg-white p-5">
                {(params.saved === moment.id || params.updated === moment.id) && (
                  <p className="mb-3 text-sm font-medium text-green-800">
                    {params.saved === moment.id ? "Saved this moment." : "Updated how this moment can be considered."}
                  </p>
                )}
                <p className="text-xs font-medium text-stone-500">
                  Saved {moment.createdAt.slice(0, 10)}
                  {" · "}
                  {moment.consideration === "private" ? "Private moment" : "Eligible for optional private matching"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-stone-900">{moment.description}</p>
                {moment.reflection && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700">
                    <strong>What it meant to you:</strong> {moment.reflection}
                  </p>
                )}
                {moment.url && (
                  <a href={moment.url} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-block max-w-full break-all text-sm text-indigo-700 hover:underline">
                    Open saved reference ↗
                  </a>
                )}
                <form action={changeMomentConsideration.bind(null, moment.id)} className="mt-3">
                  <input type="hidden" name="consideration"
                    value={moment.consideration === "private" ? "consider-people" : "private"} />
                  <button type="submit" className="text-xs font-medium text-indigo-700 hover:underline">
                    {moment.consideration === "private"
                      ? "Allow private connection review for this moment"
                      : "Keep private (disable future connection reviews)"}
                  </button>
                </form>
                {moment.consideration === "consider-people" && (
                  <MomentPeopleReview momentId={moment.id} />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
