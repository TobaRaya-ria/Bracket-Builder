# Bracket Builder

A playful tournament bracket builder for single elimination, double elimination, round robin, and multi-stage events.

## Features

- Create seeded brackets and round-robin schedules.
- Track match results, scores, MVPs, players, and standings.
- Save projects per account with Supabase, with local-browser fallback for development.
- Export/import tournaments as `.tourney.json`.
- Export/import tournament folders as `.tourney-folder.zip`.
- Share a tournament snapshot with a generated link.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, usually `http://127.0.0.1:5173/`.

## Build

```bash
npm run build
```

## Supabase setup

1. Create a Supabase project.
2. Open Supabase SQL Editor.
3. Run [`supabase/schema.sql`](supabase/schema.sql).
4. Go to Project Settings → API and copy:
   - Project URL
   - anon public key
5. Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Then fill in:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

When these env vars are present, login/signup uses Supabase and projects sync online. Without them, the app falls back to local browser storage.

## Vercel deployment

Use these settings:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`

Add the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values in Vercel Project Settings → Environment Variables for Production, Preview, and Development.
