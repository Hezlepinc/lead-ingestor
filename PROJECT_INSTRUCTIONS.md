## Project Instructions

This project ingests leads from multiple sources, normalizes them to a common shape, routes them to destinations, notifies the office, and stores them for follow-up.

### Goals

- Minimal viable pipeline that is easy to extend
- Pluggable sources (`src/sources/*`)
- Centralized routing and notification logic (`src/processors/*`)
- Lightweight persistence (`src/storage/leads.json` for MVP)
- Optional API surface (`src/server.js`)

### Data Shape (MVP)

```json
{
  "id": "uuid-or-hash",
  "source": "powerplay|websiteForm|googleAds|homeadvisor|...",
  "receivedAt": "ISO-8601",
  "contact": { "name": "", "email": "", "phone": "" },
  "meta": { "notes": "...", "raw": {} }
}
```

### Flow (MVP)

1. Source collects lead(s) and emits the common shape
2. Processor `leadRouter` decides destinations and triggers notifications
3. `notifyOffice` sends email and/or SMS
4. Lead logged to `storage/leads.json`

### Local Dev

- Put secrets in `.env` (copy from `.env.example`)
- Run `npm run dev`
- Test an individual source via scripts in `scripts/`

### Future

- Replace file storage with a DB
- Add deduplication, retries, idempotency keys
- Add more sources (Google Ads API, HomeAdvisor API/scraping)
- Add metrics and dashboards
