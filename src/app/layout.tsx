import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relationship Assistant",
  description: "Rediscover, understand, and thoughtfully maintain the relationships that matter.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold text-indigo-700">
              <span aria-hidden className="text-xl">♡</span>
              Relationship Assistant
            </Link>
            <nav aria-label="Primary navigation" className="flex items-center gap-5 text-sm font-medium">
              <Link href="/" className="text-indigo-700 hover:underline">Home</Link>
              <Link href="/relationships" className="text-stone-700 hover:text-indigo-700 hover:underline">People</Link>
              <Link href="/moments" className="text-stone-700 hover:text-indigo-700 hover:underline">Moments</Link>
            </nav>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              Prototype · local data
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
