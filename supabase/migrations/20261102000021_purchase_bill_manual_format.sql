-- Purchase bills: support the same practical line format as sales bills.
-- Discount is stored per line and never changes the product master price.

alter table public.purchase_bill_lines
  add column if not exists discount numeric(14,2) not null default 0 check (discount >= 0);

create or replace function public.confirm_purchase_bill(p jsonb)
returns uuid language plpgsql security definer
set search_path = public, extensions, pg_catalog as $$
declare
  v_uid uuid := public.require_signed_in();
  v_supplier text := nullif(btrim(p->>'supplier_name'), '');
  v_invno text := nullif(btrim(p->>'supplier_invoice_number'), '');
  v_date date := nullif(p->>'purchase_date', '')::date;
  v_items jsonb := p->'items';
  v_src text := nullif(p->>'source_reference', '');
  v_tot jsonb := coalesce(p->'totals', '{}'::jsonb);
  v_gstin text := nullif(upper(btrim(p->>'supplier_gstin')), '');
  v_addr text := nullif(btrim(p->>'supplier_address'), '');
  v_party public.parties%rowtype;
  v_bill uuid := gen_random_uuid();
  it jsonb; ord bigint;
  v_desc text; v_qty numeric; v_rate numeric; v_total numeric; v_discount numeric; v_gst numeric; v_hsn text; v_pid uuid; v_track boolean;
begin
  if v_supplier is null then raise exception 'Enter the supplier name.'; end if;
  if v_invno is null then raise exception 'Enter the supplier bill number.'; end if;
  if v_date is null then raise exception 'Enter the purchase date.'; end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'Add at least one line.'; end if;
  if v_src is not null and split_part(v_src, '/', 1) <> v_uid::text then raise exception 'The uploaded document does not belong to this account.'; end if;

  select * into v_party from public.parties where lower(btrim(name)) = lower(v_supplier);
  if not found then
    select p2.* into v_party from public.party_aliases a join public.parties p2 on p2.id = a.party_id where lower(btrim(a.alias)) = lower(v_supplier);
  end if;
  if not found then
    insert into public.parties (kind, name, gstin, address1) values ('supplier', v_supplier, v_gstin, v_addr) returning * into v_party;
  else
    update public.parties set kind = case when kind = 'customer' then 'both' else kind end, gstin = coalesce(gstin, v_gstin), address1 = coalesce(address1, v_addr) where id = v_party.id;
  end if;

  begin
    insert into public.purchase_bills
      (id, supplier_id, supplier_name, supplier_gstin, supplier_address, supplier_invoice_number, purchase_date,
       purchase_order_number, challan_number, subtotal, tax_total, round_off, grand_total, status, extraction_metadata, source_file_path)
    values
      (v_bill, v_party.id, v_supplier, v_gstin, v_addr, v_invno, v_date,
       nullif(btrim(p->>'purchase_order_number'), ''), nullif(btrim(p->>'challan_number'), ''),
       nullif(v_tot->>'subtotal', '')::numeric, nullif(v_tot->>'tax_total', '')::numeric,
       nullif(v_tot->>'round_off', '')::numeric, nullif(v_tot->>'grand_total', '')::numeric, 'confirmed',
       coalesce(p->'extraction', '{}'::jsonb) || jsonb_build_object('source_filename', p->>'source_filename'), v_src);
  exception when unique_violation then
    raise exception 'Purchase bill % from % is already recorded.', v_invno, v_supplier;
  end;

  for it, ord in select value, ordinality from jsonb_array_elements(v_items) with ordinality loop
    v_desc := nullif(btrim(it->>'description'), '');
    v_qty := nullif(it->>'quantity', '')::numeric;
    v_rate := nullif(it->>'unit_rate', '')::numeric;
    v_discount := coalesce(nullif(it->>'discount', '')::numeric, 0);
    v_total := nullif(it->>'line_total', '')::numeric;
    v_gst := nullif(it->>'gst_rate', '')::numeric;
    v_hsn := nullif(btrim(it->>'hsn'), '');
    v_pid := nullif(it->>'product_id', '')::uuid;
    if v_desc is null then raise exception 'Line % needs a description.', ord; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Line % needs a quantity greater than zero.', ord; end if;
    if v_rate is null and v_total is null then raise exception 'Line % needs a unit rate or a line amount.', ord; end if;
    if v_discount < 0 then raise exception 'Line % has an invalid discount.', ord; end if;
    if v_pid is not null and not exists (select 1 from public.products where id = v_pid) then v_pid := null; end if;
    if v_pid is null then select id into v_pid from public.products where lower(btrim(name)) = lower(v_desc); end if;
    if v_pid is null then select a.product_id into v_pid from public.product_aliases a where lower(btrim(a.alias)) = lower(v_desc) limit 1; end if;
    if v_pid is null then
      insert into public.products (name, hsn, rate, gst, track_stock, active)
      values (v_desc, coalesce(v_hsn, '4820'), coalesce(v_rate, round(v_total / v_qty, 2), 0), case when v_gst between 0 and 28 then v_gst else 0 end, true, true)
      returning id into v_pid;
    end if;
    insert into public.purchase_bill_lines
      (purchase_bill_id, position, product_id, description, hsn, quantity, unit, unit_rate, discount, line_total, gst_rate, cgst, sgst, igst)
    values
      (v_bill, ord::int, v_pid, v_desc, v_hsn, v_qty, nullif(btrim(it->>'unit'), ''), v_rate, v_discount, v_total,
       case when v_gst between 0 and 28 then v_gst end,
       nullif(it->>'cgst', '')::numeric, nullif(it->>'sgst', '')::numeric, nullif(it->>'igst', '')::numeric);
    select track_stock into v_track from public.products where id = v_pid;
    if v_track then
      insert into public.stock_movements (product_id, qty_delta, reason, ref_type, ref_id) values (v_pid, v_qty, 'Purchase: ' || v_supplier || ' bill ' || v_invno, 'purchase', v_bill);
    end if;
  end loop;
  return v_bill;
end;
$$;

create or replace function public.sync_purchase_bill_json()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_bill_id uuid := coalesce(new.purchase_bill_id, old.purchase_bill_id);
begin
  update public.purchase_bills b set bill_json = jsonb_build_object(
    'id', b.id, 'supplier_id', b.supplier_id, 'supplier_name', b.supplier_name, 'supplier_gstin', b.supplier_gstin,
    'supplier_address', b.supplier_address, 'supplier_invoice_number', b.supplier_invoice_number, 'purchase_date', b.purchase_date,
    'purchase_order_number', b.purchase_order_number, 'challan_number', b.challan_number, 'subtotal', b.subtotal,
    'tax_total', b.tax_total, 'round_off', b.round_off, 'grand_total', b.grand_total, 'status', b.status,
    'source_file_path', b.source_file_path, 'extraction_metadata', b.extraction_metadata,
    'items', coalesce((select jsonb_agg(jsonb_build_object('position', l.position, 'product_id', l.product_id, 'description', l.description,
      'hsn', l.hsn, 'quantity', l.quantity, 'unit', l.unit, 'unit_rate', l.unit_rate, 'discount', l.discount, 'line_total', l.line_total,
      'gst_rate', l.gst_rate, 'cgst', l.cgst, 'sgst', l.sgst, 'igst', l.igst) order by l.position)
      from public.purchase_bill_lines l where l.purchase_bill_id = b.id), '[]'::jsonb)
  ) where b.id = v_bill_id;
  if tg_op = 'DELETE' then return old; end if; return new;
end;
$$;

comment on column public.purchase_bill_lines.discount is 'Per-line purchase discount; does not change the product master rate.';
