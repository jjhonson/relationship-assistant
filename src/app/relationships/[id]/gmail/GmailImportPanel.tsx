"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { findPersonGmailAddresses, preparePersonGmailReview, importPersonGmailReview, cancelPersonGmailReview } from "./actions";
import type { GmailAliasSuggestion, GmailPlanResult, GmailImportResult } from "./gmail-import-types";

const button = "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50";
const primary = "rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
function addresses(text: string) { return [...new Set(text.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))]; }

export default function GmailImportPanel({ personId, personLabel, initialAddresses, modelReady, modelName }: {
  personId: string; personLabel: string; initialAddresses: string[]; modelReady: boolean; modelName: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialAddresses.join("\n"));
  const [confirmed, setConfirmed] = useState(false);
  const [aliases, setAliases] = useState<GmailAliasSuggestion[] | null>(null);
  const [aliasPartial, setAliasPartial] = useState(false);
  const [plan, setPlan] = useState<GmailPlanResult | null>(null);
  const [receipt, setReceipt] = useState<GmailImportResult | null>(null);
  const [error, setError] = useState("");
  const [bodyApproved, setBodyApproved] = useState(false);
  const [modelApproved, setModelApproved] = useState(false);
  const [pending, begin] = useTransition();
  const review = plan?.kind === "review" ? plan.review : null;

  function find() {
    setError(""); setAliases(null);
    begin(async () => {
      try {
        const found = await findPersonGmailAddresses(personId, true);
        if (found.kind === "error") setError(found.message);
        else { setAliases(found.suggestions); setAliasPartial(found.partial); }
      } catch { setError("The header search did not complete."); }
    });
  }
  function prepare() {
    setError(""); setPlan(null); setReceipt(null); setBodyApproved(false); setModelApproved(false);
    begin(async () => {
      try { setPlan(await preparePersonGmailReview(personId, addresses(text), confirmed)); }
      catch { setError("The email search did not complete."); }
    });
  }
  function cancel() {
    if (!review) return;
    const token = review.token;
    setPlan(null); setBodyApproved(false); setModelApproved(false);
    begin(async () => { try { await cancelPersonGmailReview(personId, token); } catch {} });
  }
  function run() {
    if (!review || !bodyApproved || !modelApproved) return;
    const token = review.token;
    setError(""); setReceipt(null); setPlan(null); setBodyApproved(false); setModelApproved(false);
    begin(async () => {
      try {
        setReceipt(await importPersonGmailReview(personId, token, true, true));
        router.refresh();
      } catch { setError("Import completion could not be confirmed. Check the relationship before retrying."); }
    });
  }

  return (
    <section className="space-y-5 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-3">
        <h2 className="font-semibold text-stone-900">Confirm email addresses</h2>
        <label className="block text-sm text-stone-700">Addresses belonging to {personLabel} (up to five)
          <textarea rows={3} value={text} disabled={pending || !!review} onChange={(event) => { setText(event.target.value); setConfirmed(false); setPlan(null); }}
            placeholder="name@example.com" className="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm" />
        </label>
        <p className="text-xs leading-relaxed text-stone-600">If you don&apos;t know the address, search up to 24 sender, recipient and date headers matching this person&apos;s saved name. No bodies, AI or changes to memory.</p>
        <button type="button" className={button} onClick={find} disabled={pending || !!review}>Find possible addresses</button>
        {aliases && <div className="space-y-2">
          <p className="text-sm text-stone-600">{aliases.length ? "Possible matches. Confirm the person, not just the name." : "No address candidates in this bounded sample."}{aliasPartial ? " The sample is partial." : ""}</p>
          {aliases.map((alias) => <button type="button" key={alias.address} disabled={pending || !!review || addresses(text).includes(alias.address) || addresses(text).length >= 5}
            onClick={() => { setText([...addresses(text), alias.address].join("\n")); setConfirmed(false); setPlan(null); }} className={button + " mr-2 max-w-full break-all text-left"}>
            {alias.displayName ? alias.displayName + " · " : ""}{alias.address}
          </button>)}
        </div>}
        <label className="flex items-start gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={confirmed} disabled={pending || !!review} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
          <span>I confirm these addresses belong to {personLabel} and authorize a search of up to 40 matching message headers, dates and labels. No message bodies or AI processing.</span>
        </label>
        <button type="button" onClick={prepare} disabled={pending || !!review || !confirmed || !addresses(text).length || addresses(text).length > 5} className={primary}>Find emails</button>
      </div>
      {error && <p role="alert" className="text-sm text-amber-900">{error}</p>}
      {plan?.kind === "error" && <p role="alert" className="text-sm text-amber-900">{plan.message}</p>}
      {plan?.kind === "empty" && <div role="status" className="text-sm text-stone-700">
        No eligible new messages in this sample. {plan.scanned} headers examined, {plan.previouslyImported} already imported, {plan.reviewNeeded} held for possible overlap or conflict, {plan.excluded} excluded.
        {plan.moreAvailable && " Coverage is partial."}
      </div>}
      {review && <div className="space-y-3 border-t border-stone-200 pt-4">
        <h2 className="font-semibold">Review {review.messages.length} messages</h2>
        <p className="break-all text-sm text-stone-600">Mailbox: {review.mailbox}<br />Confirmed addresses: {review.addresses.join(", ")}</p>
        <p className="text-xs text-stone-500">{review.scanned} headers examined · {review.previouslyImported} already imported · {review.reviewNeeded} held for possible overlap or conflict · {review.excluded} excluded. {review.moreAvailable ? "More may be available. " : ""}This is a bounded sample, not full history.</p>
        <ul className="divide-y divide-stone-100 text-sm">{review.messages.map((message, index) => <li key={index} className="flex justify-between py-1"><span>{message.direction === "sent" ? "Sent" : "Received"}</span><span>{message.day}</span></li>)}</ul>
        <p className="text-xs leading-relaxed text-stone-600">Only these individual messages, no group threads or attachments. Plain text up to 12,000 characters per message and 45,000 total. The review expires after ten minutes. Existing commitments and conflicting manually entered facts will not be overwritten.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={bodyApproved} onChange={(event) => setBodyApproved(event.target.checked)} disabled={pending || !modelReady} className="mt-1" /><span>I authorize reading the selected email bodies from Gmail.</span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={modelApproved} onChange={(event) => setModelApproved(event.target.checked)} disabled={pending || !modelReady} className="mt-1" /><span>I authorize sending minimized selected text and attribution to OpenAI ({modelName}) for relationship-memory extraction, with provider storage disabled in the request. Up to {review.messages.length} paid API requests, each with at most 5,000 output tokens. I approve the associated API usage charges. Only structured observations and provenance are saved in my relationship dataset, not full email bodies.</span></label>
        {!modelReady && <p className="text-sm text-amber-900">Live AI processing has not been enabled.</p>}
        <div className="flex gap-2"><button type="button" className={primary} onClick={run} disabled={pending || !modelReady || !bodyApproved || !modelApproved}>Import selected messages</button><button type="button" className={button} disabled={pending} onClick={cancel}>Cancel</button></div>
      </div>}
      {receipt?.kind === "error" && <p role="alert" className="text-sm text-amber-900">{receipt.message}</p>}
      {receipt?.kind === "complete" && <div role="status" className="space-y-2 border-t border-stone-200 pt-4 text-sm">
        <h2 className="font-semibold">{receipt.saved} messages saved</h2>
        <p>{receipt.duplicate} already imported · {receipt.reviewNeeded} held for review · {receipt.skippedContent} unsupported or changed content · {receipt.deferredFacts} conflicting facts retained separately.</p>
        {(receipt.unconfirmed > 0 || receipt.notAttempted > 0) && <p className="text-amber-900">{receipt.unconfirmed} save outcomes unconfirmed; {receipt.notAttempted} not attempted. Check the record before searching again.</p>}
        <Link href={"/relationships/" + encodeURIComponent(personId)} className="font-medium underline underline-offset-4">View updated relationship</Link>
      </div>}
      {pending && <p role="status" className="text-xs text-stone-500">Working on your requested operation…</p>}
    </section>
  );
}
