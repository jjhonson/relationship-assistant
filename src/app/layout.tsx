import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getDatasetMode } from "../../scripts/dataset-profile.mjs";
import { listRelationships } from "@/lib/relationship-store";
import ConversationEntry from "./ConversationEntry";

// Mode is runtime configuration, not a label baked into the build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Relationship Agent",
  description: "Remember what matters and find thoughtful reasons to connect.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const people = (await listRelationships()).map((person) => ({ id: person.id, label: person.personLabel }));
  const captureAvailable = Boolean(process.env.OPENAI_API_KEY);
  const questionAvailable = captureAvailable || (process.env.NODE_ENV === "development" && getDatasetMode() === "fictional" && (!process.env.RA_STORAGE_BACKEND || process.env.RA_STORAGE_BACKEND === "json"));
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-stone-200/80 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-stone-900">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full border border-stone-400 text-base font-normal">
                ○
              </span>
              Relationship Agent
            </Link>
            <nav aria-label="Primary navigation" className="flex items-center gap-6 text-sm font-medium">
              <Link href="/" className="text-stone-800 underline-offset-4 hover:underline">Home</Link>
              <Link href="/relationships" className="text-stone-600 underline-offset-4 hover:text-stone-900 hover:underline">
                Relationships
              </Link>
              <Link href="/moments" className="text-stone-600 underline-offset-4 hover:text-stone-900 hover:underline">
                Moments
              </Link>
            </nav>
            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-500">
              {getDatasetMode() === "personal" ? "Personal alpha" : "Fictional development"}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-7">
          <ConversationEntry people={people} captureAvailable={captureAvailable} questionAvailable={questionAvailable} />
          {children}
        </main>
        <footer className="mx-auto max-w-4xl px-4 pb-5 sm:px-6">
          <details className="text-xs leading-relaxed text-stone-500">
            <summary className="cursor-pointer hover:text-stone-800">Memory &amp; privacy</summary>
            <p className="mt-2 max-w-2xl">
              Pasted conversations are reduced to sourced memory without saving the transcript.
              Your own notes retain their wording; personal moments stay private.
              A chosen photo is interpreted without retaining the image.
              Text files are imported locally as text. PDF and Office files are not yet supported.
              Questions about a relationship use saved context and do not update the record.
              Nothing is sent to anyone automatically.
            </p>
          </details>
        </footer>
      </body>
    </html>
  );
}
