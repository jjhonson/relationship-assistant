"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import HomeCapture from "./HomeCapture";
import InterfaceIcon from "./InterfaceIcon";
import type { HomePersonChoice } from "@/lib/home-identity";
import { conversationScope, personForPath, type ConversationDraft } from "@/lib/conversation-entry";

/** Keep a single capture instance mounted across navigation. The directory
 * handles lookup; only Home and the actual relationship record show input. */
export default function ConversationEntry({ people, captureAvailable }: {
  people: HomePersonChoice[];
  captureAvailable: boolean;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [draft, setDraft] = useState<ConversationDraft | null>(null);
  const current = personForPath(pathname, people);
  const scope = conversationScope(pathname, people, draft);
  const scopedPerson = people.find((person) => person.id === scope);
  const scopeUnavailable = !!scope && !scopedPerson;
  const onCapturePage = isHome || !!current;
  const sameScope = scope === current?.id;
  const visible = onCapturePage && sameScope && !scopeUnavailable;
  const resumeHref = scopedPerson ? "/relationships/" + encodeURIComponent(scopedPerson.id) : "/";
  return (
    <div className={visible ? "mx-auto w-full max-w-4xl " + (isHome ? "mb-12 pt-2 sm:mb-14 sm:pt-8" : "mb-6") : draft ? "mx-auto mb-4 max-w-4xl" : ""}>
      {isHome && <h1 className="mb-5 text-center text-3xl font-semibold tracking-tight text-stone-950 sm:mb-7 sm:text-4xl">What would you like to remember?</h1>}
      {!visible && draft && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">
          <span>{scopeUnavailable ? "Unsaved draft for a person no longer available." : "Unsaved draft" + (scopedPerson ? " about " + scopedPerson.label : " on Home")}</span>
          {!scopeUnavailable && <Link href={resumeHref} className="inline-flex items-center gap-1 font-medium text-stone-800 underline-offset-2 hover:underline">Resume draft <InterfaceIcon name="arrow" className="size-3" /></Link>}
        </div>
      )}
      <div hidden={!visible}>
        <HomeCapture key={scope ?? "all"} people={people} contextRelationshipId={scope} compact={!!scope}
          captureAvailable={captureAvailable && !scopeUnavailable}
          onDraftChange={(active) => setDraft((previous) => active ? previous ?? { relationshipId: scope ?? null } : null)} />
      </div>
    </div>
  );
}
