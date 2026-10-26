import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { Section } from "@/components/Section";
import { getContact, getContacts } from "@/lib/contacts";
import { formatDate } from "@/lib/format";

export function generateStaticParams() {
  return getContacts().map((c) => ({ id: c.id }));
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = getContact(id);
  if (!contact) notFound();

  const bullets = (items: string[]) => (
    <ul className="list-disc space-y-2 pl-5 text-stone-700 marker:text-indigo-400">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm font-medium text-indigo-700 hover:underline">
        ← Your Relationships
      </Link>
      <div className="flex items-center gap-4">
        <Avatar name={contact.name} size="lg" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{contact.name}</h1>
          <p className="text-stone-600">{contact.relationship}</p>
          <p className="text-sm text-stone-500">
            Last meaningful interaction: {formatDate(contact.lastInteraction)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Relationship History">
          <ol className="space-y-4 border-l-2 border-indigo-100 pl-5">
            {[...contact.history].reverse().map((h) => (
              <li key={h.date} className="relative">
                <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500" />
                <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  {formatDate(h.date)}
                </p>
                <p className="font-medium">{h.title}</p>
                <p className="text-sm text-stone-600">{h.note}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Important Context">{bullets(contact.importantContext)}</Section>
        <Section title="Recent Developments">{bullets(contact.recentDevelopments)}</Section>
        <Section title="Suggested Thoughtful Actions">
          <ul className="space-y-2">
            {contact.suggestedActions.map((a) => (
              <li key={a} className="rounded-lg bg-indigo-50 px-3 py-2 text-indigo-900">
                {a}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Ongoing Relationship Plan">
        <p className="mb-4 text-stone-700">
          <span className="font-medium">Goal:</span> {contact.plan.goal}
        </p>
        <ul className="grid gap-3 sm:grid-cols-3">
          {contact.plan.steps.map((s) => (
            <li key={s.cadence} className="rounded-xl border border-stone-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                {s.cadence}
              </p>
              <p className="mt-1 text-stone-700">{s.action}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
