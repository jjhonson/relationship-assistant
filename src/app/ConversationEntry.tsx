"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import HomeCapture from "./HomeCapture";
import InterfaceIcon from "./InterfaceIcon";
import type { HomePersonChoice } from "@/lib/home-identity";
import { conversationScope, findSavedPeople, personForPath, type ConversationDraft } from "@/lib/conversation-entry";

export default function ConversationEntry({ people, captureAvailable }: {
  people: HomePersonChoice[];
  captureAvailable: boolean;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConversationDraft | null>(null);
  const [query, setQuery] = useState("");
  const current = personForPath(pathname, people);
  const scope = conversationScope(pathname, people, draft);
  const scopedPerson = people.find((person) => person.id === scope);
  const expanded = isHome || open;
  const matches = findSavedPeople(query, people);
  const contextLabel = scopedPerson ? "About " + scopedPerson.label : "All relationships";
  const retainedDraft = !!draft && scope !== current?.id;
  const scopeUnavailable = !!scope && !scopedPerson;
  return (
    <section aria-label="Conversation entry" className={"mx-auto w-full max-w-4xl " + (isHome ? "mb-12 pt-2 sm:mb-14 sm:pt-8" : "mb-6")}>
      {isHome ? (
        <h1 className="mb-5 text-center text-3xl font-semibold tracking-tight text-stone-950 sm:mb-7 sm:text-4xl">What would you like to remember?</h1>
      ) : (
        <button type="button" aria-expanded={expanded} aria-controls="conversation-panel" onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left hover:border-stone-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-600">
          <InterfaceIcon name="chat" className="size-5 shrink-0 text-stone-500" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-stone-500">{draft ? "Draft · " : ""}{contextLabel}</span>
            <span className="block truncate text-sm text-stone-800">{expanded ? "Find people or remember something" : "Remember something or find someone…"}</span>
          </span>
          <InterfaceIcon name={expanded ? "close" : "chevron"} className="size-4 shrink-0 text-stone-500" />
        </button>
      )}
      <div id="conversation-panel" hidden={!expanded} className={isHome ? "space-y-3" : "mt-3 space-y-3"}>
        <div className="relative rounded-xl border border-stone-200 bg-white">
          <div className="flex items-center gap-2 px-3 py-2">
            <InterfaceIcon name="search" className="size-4 shrink-0 text-stone-500" />
            <label htmlFor="conversation-person-search" className="sr-only">Find a saved person by name</label>
            <input id="conversation-person-search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Find someone by name" className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-500"
              autoComplete="off" />
            {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><InterfaceIcon name="close" /></button>}
          </div>
          {query.trim() && (
            <ul className="max-h-64 overflow-auto border-t border-stone-100 px-2 py-1" aria-label="Saved people matching your search">
              {matches.slice(0, 8).map((person) => (
                <li key={person.id}><Link href={"/relationships/" + encodeURIComponent(person.id)}
                  onClick={() => { setQuery(""); setOpen(false); }}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-stone-800 hover:bg-stone-100">
                  <span>{person.label}</span><InterfaceIcon name="arrow" className="size-3 text-stone-500" />
                </Link></li>
              ))}
              {!matches.length && <li className="px-3 py-2 text-sm text-stone-500">No saved people match.</li>}
              {matches.length > 8 && <li className="px-3 py-2 text-xs text-stone-500">Keep typing to narrow {matches.length} matches.</li>}
            </ul>
          )}
        </div>
        {retainedDraft && <p className="text-xs text-stone-600">Your unsaved draft is still scoped to {scopedPerson?.label ?? (scopeUnavailable ? "the original person" : "all relationships")}.</p>}
        <HomeCapture key={scope ?? "all"} people={people} contextRelationshipId={scope} compact={!isHome}
          captureAvailable={captureAvailable && !scopeUnavailable}
          onDraftChange={(active) => setDraft((previous) => active ? previous ?? { relationshipId: scope ?? null } : null)} />
      </div>
    </section>
  );
}
