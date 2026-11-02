-- 0003 billing: import batches, sales invoices (+lines), purchase bills (+lines), stock ledger.

-- One row per run of the old-bill import, so a whole import can be audited or undone.
create table public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  summary     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table public.sales_invoices (
  id                  uuid primary key default gen_random_uuid(),
  invoice_no          integer not null check (invoice_no > 0),
  invoice_date        date not null,
  -- Indian financial year (April-March) identified by its starting year: 2025 means FY 2025-26.
  financial_year      smallint generated always as (
                        (case when extract(month from invoice_date) >= 4
                              then extract(year from invoice_date)
                              else extract(year from invoice_date) - 1 end)::smallint
                      ) stored,
  challan_no          text,
  po_no               text,
  customer_id         uuid references public.parties(id) on delete set null,
  -- Snapshots: what was printed on the bill. They never change when the party is edited.
  customer_name       text not null check (btrim(customer_name) <> ''),
  customer_gstin      text,
  customer_address1   text,
  customer_address2   text,
  subtotal            numeric(14,2) not null check (subtotal >= 0),
  cgst                numeric(14,2) not null check (cgst >= 0),
  sgst                numeric(14,2) not null check (sgst >= 0),
  round_off           numeric(6,2)  not null default 0,
  total               numeric(14,2) not null check (total >= 0),
  status              text not null default 'final' check (status in ('final','cancelled')),
  -- Provenance. 'app' bills are created in the app; 'excel_import' bills are old bills loaded from Excel.
  source              text not null default 'app' check (source in ('app','excel_import')),
  source_file         text,
  import_warning      text,
  import_batch_id     uuid references public.import_batches(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sales_invoices_totals_match check (total = subtotal + cgst + sgst + round_off),
  -- Invoice numbers are unique per financial year (GST rule), not globally.
  constraint sales_invoices_fy_no_key unique (financial_year, invoice_no)
);
create index sales_invoices_date_idx     on public.sales_invoices (invoice_date desc, invoice_no desc);
create index sales_invoices_no_idx       on public.sales_invoices (invoice_no);
create index sales_invoices_customer_idx on public.sales_invoices (customer_id);
create index sales_invoices_batch_idx    on public.sales_invoices (import_batch_id) where import_batch_id is not null;

create table public.sales_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.sales_invoices(id) on delete cascade,
  position     integer not null check (position > 0),
  product_id   uuid references public.products(id) on delete set null,
  description  text not null check (btrim(description) <> ''),
  hsn          text,
  gst          numeric(5,2)  not null default 0 check (gst between 0 and 28),
  qty          numeric(12,3) not null check (qty > 0),
  rate         numeric(12,2) not null check (rate >= 0),
  amount       numeric(14,2) not null check (amount >= 0),
  cgst         numeric(14,2) not null check (cgst >= 0),
  sgst         numeric(14,2) not null check (sgst >= 0),
  total        numeric(14,2) not null check (total >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint sales_invoice_lines_position_key unique (invoice_id, position),
  constraint sales_invoice_lines_totals_match check (total = amount + cgst + sgst)
);
create index sales_invoice_lines_product_idx on public.sales_invoice_lines (product_id);

create table public.purchase_bills (
  id                      uuid primary key default gen_random_uuid(),
  supplier_id             uuid references public.parties(id) on delete set null,
  supplier_name           text not null check (btrim(supplier_name) <> ''),
  supplier_gstin          text,
  supplier_address        text,
  supplier_invoice_number text not null check (btrim(supplier_invoice_number) <> ''),
  purchase_date           date not null,
  purchase_order_number   text,
  challan_number          text,
  subtotal                numeric(14,2) check (subtotal   is null or subtotal   >= 0),
  tax_total               numeric(14,2) check (tax_total  is null or tax_total  >= 0),
  round_off               numeric(6,2),
  grand_total             numeric(14,2) check (grand_total is null or grand_total >= 0),
  status                  text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  extraction_metadata     jsonb not null default '{}'::jsonb,
  source_file_path        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint purchase_bills_supplier_invoice_key unique (supplier_id, supplier_invoice_number)
);
create index purchase_bills_date_idx on public.purchase_bills (purchase_date desc);

create table public.purchase_bill_lines (
  id                uuid primary key default gen_random_uuid(),
  purchase_bill_id  uuid not null references public.purchase_bills(id) on delete cascade,
  position          integer not null check (position > 0),
  product_id        uuid references public.products(id) on delete set null,
  description       text not null check (btrim(description) <> ''),
  hsn               text,
  quantity          numeric(12,3) not null check (quantity > 0),
  unit              text,
  unit_rate         numeric(12,2) check (unit_rate  is null or unit_rate  >= 0),
  line_total        numeric(14,2) check (line_total is null or line_total >= 0),
  gst_rate          numeric(5,2)  check (gst_rate   is null or gst_rate between 0 and 28),
  cgst              numeric(14,2) check (cgst is null or cgst >= 0),
  sgst              numeric(14,2) check (sgst is null or sgst >= 0),
  igst              numeric(14,2) check (igst is null or igst >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint purchase_bill_lines_position_key unique (purchase_bill_id, position)
);
create index purchase_bill_lines_product_idx on public.purchase_bill_lines (product_id);

-- Stock ledger: every change is a row, current stock is the sum. RESTRICT keeps history intact.
create table public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete restrict,
  qty_delta   numeric(14,3) not null check (qty_delta <> 0),
  reason      text not null check (btrim(reason) <> ''),
  ref_type    text not null check (ref_type in ('sale','purchase','adjustment','deletion')),
  ref_id      uuid,
  created_at  timestamptz not null default now()
);
create index stock_movements_product_idx on public.stock_movements (product_id);
create index stock_movements_ref_idx     on public.stock_movements (ref_id) where ref_id is not null;

create trigger sales_invoices_touch_updated_at       before update on public.sales_invoices       for each row execute function public.touch_updated_at();
create trigger sales_invoice_lines_touch_updated_at  before update on public.sales_invoice_lines  for each row execute function public.touch_updated_at();
create trigger purchase_bills_touch_updated_at       before update on public.purchase_bills       for each row execute function public.touch_updated_at();
create trigger purchase_bill_lines_touch_updated_at  before update on public.purchase_bill_lines for each row execute function public.touch_updated_at();
