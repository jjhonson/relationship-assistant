import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relationship Assistant",
  description:
    "Rediscover, understand, and thoughtfully maintain the relationships that matter.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold text-indigo-700">
              <span aria-hidden className="text-xl">♡</span>
              Relationship Assistant
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/discover" className="font-medium text-indigo-700 underline">Discover relationships</Link>
              <Link href="/pilot" className="text-stone-600 underline">Fictional context pilot</Link>
              <Link href="/gmail" className="text-stone-600 underline">Gmail PoC</Link>
            </nav>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              Prototype · sample data
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
