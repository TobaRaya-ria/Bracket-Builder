# Bracket Builder

A playful tournament bracket builder for single elimination, double elimination, round robin, and multi-stage events.

## Features

- Create seeded brackets and round-robin schedules.
- Track match results, scores, MVPs, players, and standings.
- Save projects per local account in the browser.
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

## Production note

The current login/signup system is local-browser storage. It is good for testing the interface, but it is not real cloud authentication. For a proper public website where users can log in from any device and keep their projects online, connect the app to a backend such as Supabase or Firebase before launch.
