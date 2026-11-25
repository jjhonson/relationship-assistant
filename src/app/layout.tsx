import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relationship Agent",
  description: "Remember what matters and find thoughtful reasons to connect.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
              Development alpha
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
