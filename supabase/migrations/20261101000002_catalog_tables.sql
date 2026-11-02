-- 0002 catalog: business (single row), parties (+aliases), products (+aliases).

create table public.business (
  id               integer primary key default 1 check (id = 1),
  name             text not null check (btrim(name) <> ''),
  address1         text,
  address2         text,
  phone            text,
  gstin            text,
  pan              text,
  bank_name        text,
  bank_account     text,
  bank_ifsc        text,
  declaration      text,
  next_invoice_no  integer not null default 5601 check (next_invoice_no > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.business is 'Exactly one row (id = 1): the seller printed on every invoice, plus the invoice number counter.';

create table public.parties (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'customer' check (kind in ('customer','supplier','both')),
  name        text not null check (btrim(name) <> ''),
  gstin       text,
  address1    text,
  address2    text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index parties_name_key on public.parties (lower(btrim(name)));
create index parties_name_trgm on public.parties using gin (name extensions.gin_trgm_ops);
comment on table public.parties is 'Customers and suppliers in one table. Bills copy the name/GSTIN/address at billing time, so editing a party never rewrites old bills.';

create table public.party_aliases (
  id          uuid primary key default gen_random_uuid(),
  party_id    uuid not null references public.parties(id) on delete cascade,
  alias       text not null check (btrim(alias) <> ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index party_aliases_alias_key on public.party_aliases (lower(btrim(alias)));
create index party_aliases_party_idx on public.party_aliases (party_id);
create index party_aliases_alias_trgm on public.party_aliases using gin (alias extensions.gin_trgm_ops);
comment on table public.party_aliases is 'Other spellings of a party name (typos, old names). Used by Ask Supra lookups and by the old-bill import to link bills to the right party.';

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (btrim(name) <> ''),
  hsn          text not null default '4820',
  rate         numeric(12,2) not null default 0 check (rate >= 0),
  gst          numeric(5,2)  not null default 0 check (gst between 0 and 28),
  track_stock  boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint products_name_key unique (name)
);
create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
comment on table public.products is 'Catalog. rate and gst are only the suggested defaults for new bills; every bill line keeps its own rate/gst. There is no stock column: stock is derived from stock_movements.';

create table public.product_aliases (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  alias       text not null check (btrim(alias) <> ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_aliases_product_alias_key unique (product_id, alias)
);
create index product_aliases_alias_trgm on public.product_aliases using gin (alias extensions.gin_trgm_ops);

create trigger business_touch_updated_at        before update on public.business        for each row execute function public.touch_updated_at();
create trigger parties_touch_updated_at         before update on public.parties         for each row execute function public.touch_updated_at();
create trigger party_aliases_touch_updated_at   before update on public.party_aliases   for each row execute function public.touch_updated_at();
create trigger products_touch_updated_at        before update on public.products        for each row execute function public.touch_updated_at();
create trigger product_aliases_touch_updated_at before update on public.product_aliases for each row execute function public.touch_updated_at();
