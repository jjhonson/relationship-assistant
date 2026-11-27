"use client";

import Link from "next/link";
import { useState } from "react";
import InterfaceIcon from "@/app/InterfaceIcon";
import { filterDirectoryPeople } from "@/lib/conversation-entry";

export type DirectoryPerson = { id: string; label: string; detail: string; lastContact: string };

export default function RelationshipDirectory({ people }: { people: DirectoryPerson[] }) {
  const [query, setQuery] = useState("");
  const rows = filterDirectoryPeople(query, people);
  return (
    <section aria-label="Saved relationships" className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-stone-300 bg-white px-4 py-3 focus-within:ring-2 focus-within:ring-stone-200">
        <InterfaceIcon name="search" className="size-5 shrink-0 text-stone-500" />
        <label htmlFor="relationship-search" className="sr-only">Search relationships by name</label>
        <input id="relationship-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name" autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-500" />
      </div>
      <p role="status" className="text-xs text-stone-500">
        {query.trim() ? rows.length + " of " + people.length : people.length} {people.length === 1 ? "person" : "people"}
      </p>
      {rows.length ? (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {rows.map((person) => {
            const initials = person.label.replace(/\s*\(fictional\)$/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
            return (
              <li key={person.id}>
                <Link href={"/relationships/" + encodeURIComponent(person.id)}
                  className="group flex items-center gap-3 px-4 py-3 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-stone-500">
                  <div aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-sm font-medium text-stone-600">{initials || "?"}</div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-stone-900">{person.label}</p>
                    {person.detail && <p className="break-words text-xs text-stone-500">{person.detail}</p>}
                    {person.lastContact && <p className="mt-0.5 text-xs text-stone-500 sm:hidden">{person.lastContact}</p>}
                  </div>
                  {person.lastContact && <span className="hidden shrink-0 text-xs text-stone-500 sm:inline">{person.lastContact}</span>}
                  <InterfaceIcon name="chevron" className="size-4 shrink-0 text-stone-400 group-hover:text-stone-700" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-500">{people.length ? "No matching relationships." : "No relationships saved yet."}</p>
      )}
    </section>
  );
}
