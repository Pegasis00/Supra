-- Keep a canonical JSON snapshot of every sales bill alongside normalized rows.
-- The relational tables remain the accounting source of truth; this snapshot is
-- useful for export, audit, and model/document workflows.

alter table public.sales_invoices
  add column if not exists bill_json jsonb not null default '{}'::jsonb;

create or replace function public.sync_sales_invoice_json()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id, new.id, old.id);
begin
  update public.sales_invoices i
  set bill_json = jsonb_build_object(
    'id', i.id,
    'invoice_no', i.invoice_no,
    'invoice_date', i.invoice_date,
    'challan_no', i.challan_no,
    'po_no', i.po_no,
    'customer_id', i.customer_id,
    'customer_name', i.customer_name,
    'customer_gstin', i.customer_gstin,
    'customer_address1', i.customer_address1,
    'customer_address2', i.customer_address2,
    'subtotal', i.subtotal,
    'cgst', i.cgst,
    'sgst', i.sgst,
    'round_off', i.round_off,
    'total', i.total,
    'status', i.status,
    'source', i.source,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', l.position,
        'product_id', l.product_id,
        'description', l.description,
        'hsn', l.hsn,
        'gst', l.gst,
        'qty', l.qty,
        'rate', l.rate,
        'amount', l.amount,
        'cgst', l.cgst,
        'sgst', l.sgst,
        'total', l.total
      ) order by l.position)
      from public.sales_invoice_lines l
      where l.invoice_id = i.id
    ), '[]'::jsonb)
  )
  where i.id = v_invoice_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sales_invoice_json_on_lines on public.sales_invoice_lines;
create trigger sales_invoice_json_on_lines
  after insert or update or delete on public.sales_invoice_lines
  for each row execute function public.sync_sales_invoice_json();

-- Backfill existing sales bills and keep future app-created bills synchronized.
update public.sales_invoices i
set bill_json = jsonb_build_object(
  'id', i.id,
  'invoice_no', i.invoice_no,
  'invoice_date', i.invoice_date,
  'challan_no', i.challan_no,
  'po_no', i.po_no,
  'customer_id', i.customer_id,
  'customer_name', i.customer_name,
  'customer_gstin', i.customer_gstin,
  'customer_address1', i.customer_address1,
  'customer_address2', i.customer_address2,
  'subtotal', i.subtotal,
  'cgst', i.cgst,
  'sgst', i.sgst,
  'round_off', i.round_off,
  'total', i.total,
  'status', i.status,
  'source', i.source,
  'items', coalesce((
    select jsonb_agg(to_jsonb(l) - 'id' - 'invoice_id' - 'created_at' - 'updated_at' order by l.position)
    from public.sales_invoice_lines l
    where l.invoice_id = i.id
  ), '[]'::jsonb)
);

comment on column public.sales_invoices.bill_json is 'Canonical JSON snapshot of the bill header and line items.';
