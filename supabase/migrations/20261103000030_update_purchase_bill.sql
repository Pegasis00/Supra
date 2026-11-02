-- Safely edit an existing purchase bill while preserving its payments.
create or replace function public.update_purchase_bill(p_id uuid, p jsonb)
returns void language plpgsql security definer
set search_path = public, extensions, pg_catalog as $$
declare
  v_uid uuid := public.require_signed_in();
  v_bill public.purchase_bills%rowtype;
  v_supplier text := nullif(btrim(p->>'supplier_name'), '');
  v_invno text := nullif(btrim(p->>'supplier_invoice_number'), '');
  v_date date := nullif(p->>'purchase_date', '')::date;
  v_items jsonb := p->'items';
  v_tot jsonb := coalesce(p->'totals', '{}'::jsonb);
  v_gstin text := nullif(upper(btrim(p->>'supplier_gstin')), '');
  v_addr text := nullif(btrim(p->>'supplier_address'), '');
  v_party public.parties%rowtype;
  it jsonb; ord bigint;
  v_desc text; v_qty numeric; v_rate numeric; v_total numeric; v_discount numeric; v_gst numeric; v_hsn text; v_pid uuid; v_track boolean;
begin
  select * into v_bill from public.purchase_bills where id = p_id and status = 'confirmed' for update;
  if not found then raise exception 'Purchase bill not found.'; end if;
  if v_supplier is null or v_invno is null or v_date is null then raise exception 'Enter supplier name, bill number, and purchase date.'; end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'Add at least one line.'; end if;
  if exists (select 1 from public.purchase_bills where supplier_invoice_number = v_invno and supplier_name = v_supplier and id <> p_id) then raise exception 'Purchase bill % from % is already recorded.', v_invno, v_supplier; end if;

  -- Remove this bill's old receipt movements after ensuring they have not already been consumed.
  for it in select jsonb_build_object('product_id', m.product_id, 'qty', sum(m.qty_delta))
    from public.stock_movements m where m.ref_id = p_id and m.ref_type = 'purchase' group by m.product_id loop
    if (select coalesce(sum(qty_delta), 0) from public.stock_movements where product_id = (it->>'product_id')::uuid) - (it->>'qty')::numeric < 0 then
      raise exception 'Cannot edit this purchase bill because its stock has already been sold.';
    end if;
  end loop;
  delete from public.stock_movements where ref_id = p_id and ref_type = 'purchase';

  select * into v_party from public.parties where lower(btrim(name)) = lower(v_supplier);
  if not found then
    insert into public.parties (kind, name, gstin, address1) values ('supplier', v_supplier, v_gstin, v_addr) returning * into v_party;
  else
    update public.parties set kind = case when kind = 'customer' then 'both' else kind end, gstin = coalesce(v_gstin, gstin), address1 = coalesce(v_addr, address1) where id = v_party.id;
  end if;

  update public.purchase_bills set supplier_id = v_party.id, supplier_name = v_supplier, supplier_gstin = v_gstin, supplier_address = v_addr,
    supplier_invoice_number = v_invno, purchase_date = v_date, subtotal = nullif(v_tot->>'subtotal', '')::numeric,
    tax_total = nullif(v_tot->>'tax_total', '')::numeric, round_off = nullif(v_tot->>'round_off', '')::numeric,
    grand_total = nullif(v_tot->>'grand_total', '')::numeric,
    extraction_metadata = coalesce(p->'extraction', extraction_metadata)
  where id = p_id;
  delete from public.purchase_bill_lines where purchase_bill_id = p_id;

  for it, ord in select value, ordinality from jsonb_array_elements(v_items) with ordinality loop
    v_desc := nullif(btrim(it->>'description'), ''); v_qty := nullif(it->>'quantity', '')::numeric; v_rate := nullif(it->>'unit_rate', '')::numeric;
    v_discount := coalesce(nullif(it->>'discount', '')::numeric, 0); v_total := nullif(it->>'line_total', '')::numeric; v_gst := nullif(it->>'gst_rate', '')::numeric; v_hsn := nullif(btrim(it->>'hsn'), ''); v_pid := nullif(it->>'product_id', '')::uuid;
    if v_desc is null or v_qty is null or v_qty <= 0 then raise exception 'Line % needs a description and quantity greater than zero.', ord; end if;
    if v_pid is null then select id into v_pid from public.products where lower(btrim(name)) = lower(v_desc) limit 1; end if;
    if v_pid is null then insert into public.products (name, hsn, rate, gst, track_stock, active) values (v_desc, coalesce(v_hsn, '4820'), coalesce(v_rate, 0), coalesce(v_gst, 0), true, true) returning id into v_pid; end if;
    insert into public.purchase_bill_lines (purchase_bill_id, position, product_id, description, hsn, quantity, unit, unit_rate, discount, line_total, gst_rate, cgst, sgst, igst)
    values (p_id, ord::int, v_pid, v_desc, v_hsn, v_qty, nullif(btrim(it->>'unit'), ''), v_rate, v_discount, v_total, v_gst, nullif(it->>'cgst', '')::numeric, nullif(it->>'sgst', '')::numeric, nullif(it->>'igst', '')::numeric);
    select track_stock into v_track from public.products where id = v_pid;
    if v_track then insert into public.stock_movements (product_id, qty_delta, reason, ref_type, ref_id) values (v_pid, v_qty, 'Purchase: ' || v_supplier || ' bill ' || v_invno, 'purchase', p_id); end if;
  end loop;
end;
$$;

grant execute on function public.update_purchase_bill(uuid, jsonb) to authenticated;
