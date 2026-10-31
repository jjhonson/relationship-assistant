import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { getContacts } from "@/lib/contacts";
import { daysSince, describeGap, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const contacts = getContacts();
  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Your Relationships</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          The people who matter most, and a gentle nudge to stay close. Select someone
          to see context and thoughtful next steps.
        </p>
      </div>
      <Link
        href="/discover"
        className="mb-6 inline-block rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800"
      >
        Discover relationships
      </Link>
      <Link
        href="/pilot"
        className="mb-6 ml-3 inline-block rounded-lg border border-indigo-700 px-4 py-2 font-medium text-indigo-700 hover:bg-indigo-50"
      >
        Try fictional context pilot
      </Link>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {contacts.map((c) => (
          <li key={c.id}>
            <Link
              href={`/contacts/${c.id}`}
              className="flex h-full flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              <div className="flex items-center gap-4">
                <Avatar name={c.name} />
                <div>
                  <h2 className="font-semibold">{c.name}</h2>
                  <p className="text-sm text-stone-600">{c.relationship}</p>
                </div>
              </div>
              <div className="mt-auto border-t border-stone-100 pt-3 text-sm">
                <span className="text-stone-500">Last meaningful interaction</span>
                <p className="font-medium text-stone-800">
                  {formatDate(c.lastInteraction)}{" "}
                  <span className="font-normal text-stone-500">
                    ({describeGap(daysSince(c.lastInteraction))})
                  </span>
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
