# Alpha Scout: laptop setup

This guide takes you from an empty laptop to a running copy of Alpha Scout, with full control over the code, the data, and the deployment. No step here needs anything beyond the accounts listed below.

## 1. Accounts you need

- A GitHub account with access to the `0xsilvaspace/alpha-scout` repository.
- A Supabase account (free tier is enough) with the `alpha-scout` project. You need its project URL and its anon publishable key. Both are in the Supabase dashboard under Project Settings, then API.
- A Google AI Studio API key for the chatbot (primary provider). Create one at Google AI Studio.
- An OpenRouter API key for the chatbot (fallback provider). Create one at openrouter.ai. This one is optional; the chatbot works with the Gemini key alone and falls back to OpenRouter only when it is set.

Keep every key private. Never paste a key into a chat message, a public file, or a commit.

## 2. Prerequisites

Install these first:

- Git: https://git-scm.com/downloads
- Node.js 20 or newer: https://nodejs.org (npm ships with Node)

Check they are installed:

```bash
git --version
node --version
npm --version
```

## 3. Clone and install

```bash
git clone https://github.com/0xsilvaspace/alpha-scout.git
cd alpha-scout
npm install
```

This installs the Next.js app, React, Tailwind CSS, Three.js, the Supabase client libraries, and the TypeScript toolchain. It does not need any other download.

## 4. Environment variables

Copy the example file and fill in your own values:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-publishable-key
GEMINI_API_KEY=your-gemini-api-key
OPENROUTER_API_KEY=your-openrouter-api-key
```

Where each value comes from:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase dashboard, Project Settings, API. The anon key is safe to expose in the browser; it is the publishable key, not the secret service key. Never put the service key in this file.
- `GEMINI_API_KEY`: Google AI Studio, create an API key in a project you own.
- `OPENROUTER_API_KEY`: openrouter.ai, create a key under Keys. Leave it blank if you do not want a fallback provider.

`.env.local` is ignored by Git and is never committed. The site loads and shows listings even with this file missing, but sign-in needs the two Supabase values and the chatbot needs at least one of the two API keys.

## 5. Supabase table for the saved archive

The saved archive needs one table in your Supabase project. Open the Supabase dashboard for the `alpha-scout` project, go to the SQL Editor, and run this:

```sql
create table public.saved_items (
  user_id uuid references auth.users on delete cascade not null,
  deal_id text not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, deal_id)
);

alter table public.saved_items enable row level security;

create policy "Users can view their own saved items"
  on public.saved_items for select
  using (auth.uid() = user_id);

create policy "Users can save items"
  on public.saved_items for insert
  with check (auth.uid() = user_id);

create policy "Users can remove their own saved items"
  on public.saved_items for delete
  using (auth.uid() = user_id);
```

Row level security is on, and each policy limits a user to their own rows, so one user can never read or change another user's saved items. You only need to run this once.

Also check the URL configuration in the Supabase dashboard under Authentication, URL Configuration:

- Site URL: `http://localhost:3000` for local development (use your production URL on the live project)
- Redirect URLs: add `http://localhost:3000/auth/callback` for local development (and `https://your-production-domain/auth/callback` for production)

These are what the sign-in confirmation link uses to send users back to the app.

## 6. Run it locally

```bash
npm run dev
```

Open http://localhost:3000. The app fetches the live listings feed from the public GitHub raw URL, so it shows the current 236 listings even on a fresh clone.

Useful commands:

```bash
npm run dev    # start the development server with hot reload
npm run build  # type check and build for production
npm run start  # serve the production build (run npm run build first)
```

## 7. Deploy to Vercel

1. Push your changes to the `main` branch on GitHub.
2. In the Vercel dashboard, choose Add New, then Project, and import the `0xsilvaspace/alpha-scout` repository.
3. Leave the framework as Next.js and the build command as `npm run build`.
4. Under Environment Variables, add the same four values from your `.env.local` (see step 4) and set them for Production.
5. Deploy. Vercel gives you a production URL; every push to `main` redeploys it automatically.

The live feed does not need a redeploy to update: the app fetches `deals.json` from GitHub at runtime, and the scheduled feed sync refreshes that file every 2 hours.

## 8. Updating the listings

Listings come from the Alpha Scout listings database, not from editing files in this repo. A scheduled sync runs every 2 hours, pulls the current listings, regenerates `deals.json` (and the built-in fallback in `lib/deals.ts`), and pushes the result to the `main` branch. Do not edit `deals.json` by hand; the next sync overwrites it.

If you want to change how the site displays listings (tabs, filters, cards, the chatbot), edit the code under `app/`, `components/`, and `lib/`, then run `npm run build` to check it compiles before you commit and push.

## 9. Troubleshooting

- `npm run dev` fails with a module error: delete `node_modules` and `package-lock.json` is not needed; just run `npm install` again.
- The page loads but sign-in does nothing: check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in `.env.local` and that the redirect URLs in Supabase match your local or production address.
- Ask Scout replies that it cannot answer: check that at least one of `GEMINI_API_KEY` and `OPENROUTER_API_KEY` is set, and restart the dev server after changing `.env.local`.
- The listings look out of date: the live feed is cached by the browser for a short time; hard refresh the page. If the feed itself is stale, check that the latest feed sync commit reached the `main` branch.
