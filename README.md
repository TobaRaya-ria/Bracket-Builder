# Bracket Builder

A playful tournament bracket builder for single elimination, double elimination, round robin, and multi-stage events.

## Features

- Create seeded brackets and round-robin schedules.
- Track match results, scores, MVPs, players, and standings.
- Rename tournaments and participant names after generation.
- Customize round-robin standings with metric priorities and optional AI-assisted rule parsing.
- Save projects per account with Supabase, with local-browser fallback for development.
- Export/import tournaments as `.tourney.json`.
- Export/import tournament folders as `.tourney-folder.zip`.
- Share a tournament snapshot with a generated link.
- Store Kitakana Elo teams, history, and match updates in Supabase.

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
4. Run [`supabase/kitakana_elo.sql`](supabase/kitakana_elo.sql).
5. Go to Project Settings → API and copy:
   - Project URL
   - anon public key
6. Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Then fill in:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

When these env vars are present, login/signup uses Supabase and projects sync online. Without them, the app falls back to local browser storage.

The first Kitakana Elo lookup for an account imports the verified workbook baseline once: 330 teams, 38 bonuses, and 453 historical matches. New submissions are stored by unique match code and recalculate directly in Supabase; no local Excel bridge is required.

## Round-robin AI rules

The metric assistant works locally with a built-in parser. To connect it to your own AI service, set `VITE_AI_RULES_ENDPOINT` to a server-side endpoint that accepts:

```json
{"message":"points scored first, then match wins","currentRules":{}}
```

Return JSON with a `rules` object containing `criteria`, `pointMode`, optional `scoreDiffBands`, and `summary`. Keep model API keys on that server-side endpoint, not in the Vite client.

## Vercel deployment

Use these settings:

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`

Add the same `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optional `VITE_AI_RULES_ENDPOINT` values in Vercel Project Settings → Environment Variables for Production, Preview, and Development.
