# Lead Ingestor (MVP)

An MVP toolkit to ingest leads from multiple sources (scrapers, webhooks, APIs), route them, notify the office, and persist them for follow-up.

## Quickstart

1. Install Node.js 18+
2. Install deps:

```bash
npm install
```

3. Copy env and fill values:

```bash
cp .env.example .env
```

4. Run in dev:

```bash
npm run dev
```

## Structure

See `PROJECT_INSTRUCTIONS.md` for the proposed architecture and file responsibilities.

## Scripts

- `npm start`: run main entry `src/index.js`
- `npm run dev`: run with nodemon
- `npm run test:powerplay`: test Powerplay source locally
- `npm run cookies:save`: save Playwright sessions

## Notes

- `src/storage/leads.json` is used as a simple append-only store for the MVP. Swap with a DB later.
- `src/server.js` is an optional Express API to be filled later.
