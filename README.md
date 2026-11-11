# ALPHA SCOUT — Global Zero-Cost Intelligence Terminal

A production-ready, fully responsive Next.js dashboard of verified free
global opportunities — scholarships, remote jobs, AI credits, crypto grants,
NFTs, banking, cloud and software — open to Nigerians. No deal requires
payment.

## Data

The 21 deals in `lib/deals.ts` are copied verbatim from the ALPHA SCOUT
Muse Space scan of 11 Nov 2026 (ids 1–21): same titles, tracks, values,
eligibility, cost types, expiry dates, source URLs, requirements, action
steps, verification status and risk notes. No deal was invented and no
value, date or link was changed.

- Total tracked value (sum of `valueUsd` where present): **$155,769**
- 9 deals carry no dollar value — their benefit is shown as text instead.
- Only 1 deal is marked **Verified** (Turing, id 6); the other 20 are
  **Pending Verification**.
- Expiry is date-relative: a deal past its `expiresOn` moves to the Archive
  tab automatically; one expiring within 48 hours is flagged Expiring Soon.
  At seed time the only Expiring Soon deal is the DAAD scholarship
  (id 2, expires 2026-11-12), so the Archive starts empty.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS v4 + lucide-react icons
- No API routes, no backend, no environment variables — static data only.

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Production build

```bash
npm run build
npm run start
```

## Deploy to Vercel

Option A — Vercel CLI:

```bash
npm i -g vercel
vercel
vercel --prod
```

Option B — Vercel dashboard: import this repository (or drag the project
folder into a new Vercel project). The framework is detected as Next.js
(`vercel.json` sets `framework: "nextjs"`); no environment variables are
needed. The live URL will be `https://<project-name>.vercel.app`.

## Project structure

```
app/
  layout.tsx        # metadata + dark shell
  page.tsx          # tabs, filters, grid wiring (client component)
  globals.css       # Tailwind v4 + terminal theme
components/
  StatsBar.tsx      # active count, total value, expiring soon, system status
  FilterBar.tsx     # search + Open to Nigeria / Worldwide / No Card / <48h
  DealCard.tsx      # card, steps accordion, official link, local report flag
lib/
  deals.ts          # Deal type, the 21 deals, helpers (daysLeft, totals…)
```
