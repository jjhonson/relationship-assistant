"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GmailMemoryReview } from "@/lib/gmail/person-import-removal";
import { removeSelectedGmailMemory } from "./memory-actions";

export default function GmailMemoryPanel({ personId, review }: { personId: string; review: GmailMemoryReview }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, begin] = useTransition();
  const [notice, setNotice] = useState("");
  const ids = review.sources.filter((source) => selected.includes(source.id)).map((source) => source.id);
  function select(id: string, checked: boolean) {
    setSelected((prior) => checked ? [...new Set([...prior, id])] : prior.filter((item) => item !== id));
    setConfirmed(false); setNotice("");
  }
  function remove() {
    if (!confirmed || !ids.length || ids.length > 1000) return;
    begin(async () => {
      try {
        const result = await removeSelectedGmailMemory(personId, ids, review.version, true);
        setNotice(result.kind === "removed"
          ? result.removedMessages + " imported messages removed; " + result.removedFacts + " unsupported facts removed; " + result.preservedFacts + " independently linked facts retained."
          : result.message);
        setSelected([]); setConfirmed(false);
        router.refresh();
      } catch { setNotice("Removal could not be confirmed. Refresh before trying again."); }
    });
  }
  return (
    <details className="rounded-xl border border-stone-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-stone-800">Review imported memory ({review.sources.length})</summary>
      <div className="mt-4 space-y-3 text-sm">
        <p className="text-stone-600">Review each message&apos;s originating mailbox, current linked facts and conflicting observations held separately. These are saved memory, not the original email text.</p>
        <button type="button" disabled={pending} className="text-sm underline underline-offset-4" onClick={() => {
          setSelected(ids.length === review.sources.length ? [] : review.sources.slice(0, 1000).map((source) => source.id)); setConfirmed(false); setNotice("");
        }}>{ids.length === review.sources.length ? "Clear selection" : "Select all (up to 1,000)"}</button>
        <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto">
          {review.sources.map((source) => <li key={source.id} className="space-y-2 py-3">
            <label className="flex items-start gap-2">
              <input type="checkbox" disabled={pending} checked={ids.includes(source.id)} onChange={(event) => select(source.id, event.target.checked)} className="mt-1" />
              <span className="min-w-0"><span className="font-medium">{source.direction === "sent" ? "Sent" : "Received"} · {source.day}</span><span className="block break-all text-xs text-stone-500">{source.mailbox}</span></span>
            </label>
            <div className="space-y-1 pl-5 text-xs text-stone-600">
              {source.facts.map((fact, index) => <p key={index}>{fact.label}: {fact.value}{fact.otherEvidence ? " (also linked elsewhere)" : ""}</p>)}
              {source.deferredFacts.map((fact, index) => <p key={"held-" + index}>Held for review: {fact.label}: {fact.value}</p>)}
              {!source.facts.length && !source.deferredFacts.length && <p>Contact history only.</p>}
            </div>
          </li>)}
        </ul>
        {ids.length > 0 && <>
          <p className="text-xs leading-relaxed text-stone-600">Remove {ids.length} selected messages and unsupported facts from the active relationship dataset. Keep other supporting evidence and manually entered notes or confirmed journal entries. No email will be deleted from Gmail. Old encrypted backups and provider retention are separate. A future explicit import may restore this information.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={pending} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" /><span>I confirm removal of the selected Gmail-derived memory.</span></label>
          <button type="button" disabled={pending || !confirmed || ids.length > 1000} onClick={remove} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 disabled:opacity-50">Remove selected memory</button>
        </>}
        {notice && <p role="status" className="text-sm text-stone-700">{notice}</p>}
      </div>
    </details>
  );
}
