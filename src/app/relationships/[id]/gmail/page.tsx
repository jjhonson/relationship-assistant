import Link from "next/link";
import { notFound } from "next/navigation";
import { getRelationship } from "@/lib/relationship-store";
import { relationshipContactFields } from "@/lib/relationship-overview";
import { relationshipToday } from "@/lib/relationship-cadence";
import { personalGmailConfig, validPersonGmailId } from "@/lib/gmail/personal-session";
import { personalGmailSessionContext } from "@/lib/gmail/personal-connection";
import { isLookupAddress } from "@/lib/gmail/messages";
import { getDatasetMode } from "../../../../../scripts/dataset-profile.mjs";
import GmailImportPanel from "./GmailImportPanel";

export const dynamic = "force-dynamic";

export default async function RelationshipGmailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  if (getDatasetMode() !== "personal" || !validPersonGmailId(id)) notFound();
  const person = await getRelationship(id);
  if (!person) notFound();
  const config = personalGmailConfig();
  const connected = config ? Boolean(await personalGmailSessionContext()) : false;
  const field = relationshipContactFields(person, relationshipToday()).find((item) => item.label === "Email");
  const initialAddresses = [...new Set((field?.values ?? []).map((item) => item.value.toLowerCase()).filter(isLookupAddress))].slice(0, 5);
  const importedCount = person.sources.filter((source) => source.gmailImport).length;
  const deferredCount = person.sources.reduce((count, source) => count + (source.gmailImport?.deferredFacts.length ?? 0), 0);
  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-12">
      <Link href={"/relationships/" + encodeURIComponent(id)} className="text-sm font-medium text-stone-600 hover:underline">← {person.personLabel}</Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Import from Gmail</h1>
        <p className="mt-1 text-sm text-stone-600">Enrich {person.personLabel}&apos;s relationship record from selected correspondence.</p>
      </header>
      {importedCount > 0 && <p className="text-sm text-stone-600">{importedCount} Gmail messages already saved.{deferredCount > 0 ? " " + deferredCount + " conflicting observations remain held for review." : ""}</p>}
      {error && <p role="alert" className="text-sm text-amber-900">Gmail authorization did not complete. You can reconnect below.</p>}
      {!config ? (
        <p className="rounded-xl border border-stone-200 p-4 text-sm text-stone-600">Personal Gmail is not enabled yet. Connecting requires the reviewed private loopback configuration and separate live-use approval. No email access has occurred.</p>
      ) : !connected ? (
        <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
          <p className="text-sm text-stone-700">Connect read-only Gmail to this private personal alpha. Connection alone does not search, read or import your email.</p>
          <form method="post" action="/api/gmail/personal/connect">
            <input type="hidden" name="personId" value={id} />
            <button type="submit" name="connect" value="yes" className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white">Connect Gmail</button>
          </form>
        </section>
      ) : (
        <>
          <GmailImportPanel key={id} personId={id} personLabel={person.personLabel} initialAddresses={initialAddresses}
            modelReady={process.env.RA_PERSONAL_GMAIL_MODEL_APPROVED === "yes" && Boolean(process.env.OPENAI_API_KEY)}
            modelName={process.env.OPENAI_RELATIONSHIP_MODEL ?? "configured relationship model"} />
          <form method="post" action="/api/gmail/personal/disconnect" className="pt-3">
            <input type="hidden" name="personId" value={id} />
            <button type="submit" className="text-sm text-stone-600 underline underline-offset-4">Disconnect Gmail</button>
            <p className="mt-2 text-xs text-stone-500">Disconnect clears this browser connection, not Google&apos;s grant. Revoke the grant from your Google Account permissions. Saved relationship memory remains.</p>
          </form>
        </>
      )}
    </div>
  );
}
