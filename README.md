# Relationship Assistant

Helps people rediscover, understand, and thoughtfully maintain important personal and professional relationships.

This is an **initial prototype**. It uses fictional, hard-coded sample data only: no Gmail, database, authentication, external APIs, or payments.

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, Vitest.

## Getting started

Requires Node.js ^22.12.0, ^24.0.0, or >=26.0.0.

```bash
npm install
npm run dev        # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Run unit tests (Vitest) |

## Structure

- `src/app/page.tsx` – "Your Relationships" dashboard
- `src/app/contacts/[id]/page.tsx` – relationship detail page (history, context, recent developments, suggested actions, plan)
- `src/lib/contacts.ts` – fictional sample data and lookups (swap this module to change the data source later)
- `src/lib/format.ts` – date/initials helpers
- `src/components/` – small shared UI components
