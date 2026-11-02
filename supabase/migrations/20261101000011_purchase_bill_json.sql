-- Keep a canonical JSON snapshot of every purchase bill alongside normalized rows.

alter table public.purchase_bills
  add column if not exists bill_json jsonb not null default '{}'::jsonb;

create or replace function public.sync_purchase_bill_json()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_bill_id uuid := coalesce(new.purchase_bill_id, old.purchase_bill_id);
begin
  update public.purchase_bills b
  set bill_json = jsonb_build_object(
    'id', b.id,
    'supplier_id', b.supplier_id,
    'supplier_name', b.supplier_name,
    'supplier_gstin', b.supplier_gstin,
    'supplier_address', b.supplier_address,
    'supplier_invoice_number', b.supplier_invoice_number,
    'purchase_date', b.purchase_date,
    'purchase_order_number', b.purchase_order_number,
    'challan_number', b.challan_number,
    'subtotal', b.subtotal,
    'tax_total', b.tax_total,
    'round_off', b.round_off,
    'grand_total', b.grand_total,
    'status', b.status,
    'source_file_path', b.source_file_path,
    'extraction_metadata', b.extraction_metadata,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', l.position,
        'product_id', l.product_id,
        'description', l.description,
        'hsn', l.hsn,
        'quantity', l.quantity,
        'unit', l.unit,
        'unit_rate', l.unit_rate,
        'line_total', l.line_total,
        'gst_rate', l.gst_rate,
        'cgst', l.cgst,
        'sgst', l.sgst,
        'igst', l.igst
      ) order by l.position)
      from public.purchase_bill_lines l
      where l.purchase_bill_id = b.id
    ), '[]'::jsonb)
  )
  where b.id = v_bill_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists purchase_bill_json_on_lines on public.purchase_bill_lines;
create trigger purchase_bill_json_on_lines
  after insert or update or delete on public.purchase_bill_lines
  for each row execute function public.sync_purchase_bill_json();

-- Backfill existing purchase bills and their line items.
update public.purchase_bills b
set bill_json = jsonb_build_object(
  'id', b.id,
  'supplier_id', b.supplier_id,
  'supplier_name', b.supplier_name,
  'supplier_gstin', b.supplier_gstin,
  'supplier_address', b.supplier_address,
  'supplier_invoice_number', b.supplier_invoice_number,
  'purchase_date', b.purchase_date,
  'purchase_order_number', b.purchase_order_number,
  'challan_number', b.challan_number,
  'subtotal', b.subtotal,
  'tax_total', b.tax_total,
  'round_off', b.round_off,
  'grand_total', b.grand_total,
  'status', b.status,
  'source_file_path', b.source_file_path,
  'extraction_metadata', b.extraction_metadata,
  'items', coalesce((
    select jsonb_agg(to_jsonb(l) - 'id' - 'purchase_bill_id' - 'created_at' - 'updated_at' order by l.position)
    from public.purchase_bill_lines l
    where l.purchase_bill_id = b.id
  ), '[]'::jsonb)
);

comment on column public.purchase_bills.bill_json is 'Canonical JSON snapshot of the purchase bill header and line items.';
