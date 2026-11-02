# Supra Billing

Phone-first billing and inventory app built with Next.js 15, React 19, TypeScript, and Supabase. It includes sales invoices and PDF generation, customer and product management, purchase bill review, inventory views, and Ask Supra chat.

## Project status

The database is defined by versioned SQL migrations in `supabase/` (the schema, views, functions, row-level security, storage bucket and seed data). A fresh Supabase project is set up with `npm run db:link` and `npm run db:push:seed`; the full steps, the migration workflow and backups are in `supabase/README.md`. The data model and the old-bill import are explained in `docs/DATABASE.md`.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Set the Supabase values before using database-backed pages:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key used by the browser client |
| `OPENROUTER_API_KEY` | No | Enables NVIDIA models through OpenRouter for Ask Supra and purchase bill extraction |
| `OPENROUTER_CHAT_MODEL` | No | NVIDIA model used by Ask Supra; code default is `nvidia/nemotron-3.5-super-vl` |
| `OPENROUTER_EXTRACTION_MODEL` | No | NVIDIA vision model used for purchase extraction; code default is `nvidia/nemotron-3.5-super-vl` |

Model API keys are server-side secrets. Do not prefix them with `NEXT_PUBLIC_` or commit `.env.local`. `OPENROUTER_API_KEY` is required for the AI features.

## Deploy to Vercel

1. Push this repository to GitHub and import it into Vercel as a Next.js project. The default build command is `npm run build`.
2. Add the environment variables above in Vercel's project settings for each environment you use.
3. Before using the deployed app, set up the Supabase project with `npm run db:push:seed` (see `supabase/README.md`) and add the two public Supabase variables in Vercel. Do not add `SUPABASE_SERVICE_ROLE_KEY` to Vercel.
4. Add the deployed Vercel URL to Supabase Auth's allowed redirect/site URL settings and configure the intended user sign-in policy.
5. Redeploy after changing environment variables.

The production build succeeding only verifies compilation and static generation; it does not verify Supabase connectivity, database objects, auth redirects, or model credentials.

## Project layout

- `app/` — Next.js pages and API routes.
- `components/` — shared application shell, pickers, and Ask Supra UI.
- `supabase/` — migrations, seed data, SQL smoke tests and the database workflow guide.
- `scripts/import-bills/` — Excel old-bill extractor and loader; `scripts/backup-data.ts` — JSON data backup.
- `lib/` — Supabase client, shared types, money/PDF helpers, and SQL guard.
- `tests/rag-chat.test.ts` — SQL guard and chat fixture tests (`npm run test:rag`).
- `docs/PROJECT_EXPLAINED.md` — architecture, user flows, and known gaps.
- `docs/DATABASE.md` — data model, per-bill data, old-bill import design.

## Validation

```bash
npm run build
npm run test:rag
```

The build was checked in the current workspace and completes successfully. The test command is available but has not been run as part of this deployment-readiness check. Neither check replaces testing against a configured Supabase project.

# Supra
