# Supabase folder: how the database is managed

This folder is the **single source of truth for the database**. If the Supabase account is ever lost again, create a new project, run the steps below, and the whole schema comes back in minutes.

It works like Alembic does for Python: every change is a small, timestamped SQL file in `migrations/`. Supabase remembers which files it has already run (in its own `supabase_migrations` table), and `db push` runs only the new ones, in order. No Python or extra tools are needed; the Supabase CLI runs through `npx`.

| Alembic | Here |
| --- | --- |
| `alembic revision` | `npm run db:new add_discount_column` |
| `alembic upgrade head` | `npm run db:push` |
| `alembic history` / current | `npm run db:list` |
| `alembic downgrade` | not used: write a new forward migration that undoes the change |

```
supabase/
  config.toml        CLI settings
  migrations/        THE schema. Never edit a file that has been pushed; add a new one.
  seed.sql           Starter data: business row, 49 customers (+4 aliases), 38 products with rates
  tests/smoke.sql    Automated checks of tables, RPCs, stock, import, security (run on a throwaway DB)
  sandbox/           Stub of Supabase's auth/storage so the tests run on plain Postgres
```

## One-time setup for a new Supabase project

1. **Create the project** at supabase.com (new account is fine). Save the database password.
2. **Auth**: Authentication > Users > *Add user* for you and your staff. Then Authentication > Sign In / Providers > Email: **turn off "Allow new users to sign up"**. The database lets *any* signed-in user see and edit the shared business data, so only people you add by hand may exist.
3. **Link and push** (from the project folder):
   ```bash
   npx supabase login
   npm run db:link          # asks for the project ref and the database password
   npm run db:push:seed     # applies all migrations, then seed.sql
   ```
   If the CLI complains about Docker, it only needs it for local features; `db push` itself does not.
4. **Keys**: Project Settings > API. Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (and in Vercel). For the import and backup scripts also add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` only. Never add it to Vercel and never prefix it with `NEXT_PUBLIC_`.
5. **Open the app > Settings** and enter the bank details (they are deliberately not in the seed) and check the next invoice number.
6. Optional: `npm run db:types` writes `lib/database.types.ts` from the live schema.

Seed notes: it is safe to run twice (every insert is "do nothing on conflict"). Rates and GST in it come from `Supra_Marketing_Invoice.xlsx`; the merges it applied (K'Sagar spellings, Pratik Stationery) are listed at the top of `seed.sql`.

## Changing the database later

```bash
npm run db:new add_party_phone2     # creates supabase/migrations/<timestamp>_add_party_phone2.sql
# write the SQL in that file, including grants and RLS for anything new
npm run db:push
```

Rules that keep this safe:

1. Never edit or delete a migration that has been pushed. Add a new one.
2. A new table needs `enable row level security`, policies and explicit `grant`s in the same migration. New functions get `grant execute ... to authenticated` explicitly (they are locked down by default).
3. Bills, purchase bills and the stock ledger change only through the RPC functions, never by direct writes from the app.
4. Never run SQL by hand in the dashboard that is not also a migration file, or the repo and the live database drift apart again.

## Testing migrations before pushing

Quickest, with Docker installed: `npx supabase start`, then `npx supabase db reset` (applies migrations and the seed locally), then run `supabase/tests/smoke.sql` with `psql` against the local database (the connection string is in `npx supabase status`). The test runs inside a transaction and rolls back.

Without Docker, use any local PostgreSQL 15+ and a throwaway database: run `sandbox/00_supabase_stub.sql`, then each migration in order, then `tests/smoke.sql` (from the project root, because it includes `supabase/seed.sql`). **Never run the stub on a Supabase project.**

## Backups

The free plan has no automatic backups, so keep your own: `npm run db:backup` writes every table to `private-data/backups/<date>/*.json` (git-ignored). Copy that folder to Drive or a pen drive after busy days. Schema is already safe in git; this protects the data.

## Importing the old bills

See `docs/DATABASE.md` (section "Old bills") for the full flow. In short: put the Excel files in `oldbills/`, then `npm run import:extract`, read `private-data/out/import-report.csv`, then `npm run import:load -- --dry-run` and finally `npm run import:load`.
