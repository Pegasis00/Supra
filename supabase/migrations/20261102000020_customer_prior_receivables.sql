-- Receivables from before the imported 2026-27 bill history.
alter table public.parties
  add column if not exists opening_receivable numeric(14,2) not null default 0
  check (opening_receivable >= 0);

comment on column public.parties.opening_receivable is 'Outstanding amount carried forward from periods whose bills are not stored in this database.';
