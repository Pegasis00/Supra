-- 0006 purchases, stock and lookup RPCs.

create or replace function public.confirm_purchase_bill(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid      uuid := public.require_signed_in();
  v_supplier text := nullif(btrim(p->>'supplier_name'), '');
  v_invno    text := nullif(btrim(p->>'supplier_invoice_number'), '');
  v_date     date := nullif(p->>'purchase_date', '')::date;
  v_items    jsonb := p->'items';
  v_src      text := nullif(p->>'source_reference', '');
  v_tot      jsonb := coalesce(p->'totals', '{}'::jsonb);
  v_gstin    text := nullif(upper(btrim(p->>'supplier_gstin')), '');
  v_addr     text := nullif(btrim(p->>'supplier_address'), '');
  v_party    public.parties%rowtype;
  v_bill     uuid := gen_random_uuid();
  it         jsonb;
  ord        bigint;
  v_desc     text;
  v_qty      numeric;
  v_rate     numeric;
  v_total    numeric;
  v_gst      numeric;
  v_hsn      text;
  v_pid      uuid;
  v_track    boolean;
begin
  if v_supplier is null then raise exception 'Enter the supplier name.'; end if;
  if v_invno is null then raise exception 'Enter the supplier bill number.'; end if;
  if v_date is null then raise exception 'Enter the purchase date.'; end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Add at least one line.';
  end if;
  if v_src is not null and split_part(v_src, '/', 1) <> v_uid::text then
    raise exception 'The uploaded document does not belong to this account.';
  end if;

  -- Supplier: match by name, then by alias, else create. An existing customer becomes "both".
  select * into v_party from public.parties where lower(btrim(name)) = lower(v_supplier);
  if not found then
    select p2.* into v_party from public.party_aliases a join public.parties p2 on p2.id = a.party_id
     where lower(btrim(a.alias)) = lower(v_supplier);
  end if;
  if not found then
    insert into public.parties (kind, name, gstin, address1)
    values ('supplier', v_supplier, v_gstin, v_addr) returning * into v_party;
  else
    update public.parties set
      kind = case when kind = 'customer' then 'both' else kind end,
      gstin = coalesce(gstin, v_gstin),
      address1 = coalesce(address1, v_addr)
    where id = v_party.id;
  end if;

  begin
    insert into public.purchase_bills
      (id, supplier_id, supplier_name, supplier_gstin, supplier_address, supplier_invoice_number, purchase_date,
       purchase_order_number, challan_number, subtotal, tax_total, round_off, grand_total, status,
       extraction_metadata, source_file_path)
    values
      (v_bill, v_party.id, v_supplier, v_gstin, v_addr, v_invno, v_date,
       nullif(btrim(p->>'purchase_order_number'), ''), nullif(btrim(p->>'challan_number'), ''),
       nullif(v_tot->>'subtotal', '')::numeric, nullif(v_tot->>'tax_total', '')::numeric,
       nullif(v_tot->>'round_off', '')::numeric, nullif(v_tot->>'grand_total', '')::numeric, 'confirmed',
       coalesce(p->'extraction', '{}'::jsonb) || jsonb_build_object('source_filename', p->>'source_filename'),
       v_src);
  exception when unique_violation then
    raise exception 'Purchase bill % from % is already recorded.', v_invno, v_supplier;
  end;

  for it, ord in select value, ordinality from jsonb_array_elements(v_items) with ordinality loop
    v_desc  := nullif(btrim(it->>'description'), '');
    v_qty   := nullif(it->>'quantity', '')::numeric;
    v_rate  := nullif(it->>'unit_rate', '')::numeric;
    v_total := nullif(it->>'line_total', '')::numeric;
    v_gst   := nullif(it->>'gst_rate', '')::numeric;
    v_hsn   := nullif(btrim(it->>'hsn'), '');
    v_pid   := nullif(it->>'product_id', '')::uuid;

    if v_desc is null then raise exception 'Line % needs a description.', ord; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Line % needs a quantity greater than zero.', ord; end if;
    if v_rate is null and v_total is null then
      raise exception 'Line % needs a unit rate or a line amount.', ord;
    end if;

    if v_pid is not null and not exists (select 1 from public.products where id = v_pid) then v_pid := null; end if;
    if v_pid is null then
      select id into v_pid from public.products where lower(btrim(name)) = lower(v_desc);
    end if;
    if v_pid is null then
      select a.product_id into v_pid from public.product_aliases a where lower(btrim(a.alias)) = lower(v_desc) limit 1;
    end if;
    if v_pid is null then
      insert into public.products (name, hsn, rate, gst, track_stock, active)
      values (v_desc, coalesce(v_hsn, '4820'), coalesce(v_rate, round(v_total / v_qty, 2), 0),
              case when v_gst between 0 and 28 then v_gst else 0 end, true, true)
      returning id into v_pid;
    end if;

    insert into public.purchase_bill_lines
      (purchase_bill_id, position, product_id, description, hsn, quantity, unit, unit_rate, line_total, gst_rate, cgst, sgst, igst)
    values
      (v_bill, ord::int, v_pid, v_desc, v_hsn, v_qty, nullif(btrim(it->>'unit'), ''), v_rate, v_total,
       case when v_gst between 0 and 28 then v_gst end,
       nullif(it->>'cgst', '')::numeric, nullif(it->>'sgst', '')::numeric, nullif(it->>'igst', '')::numeric);

    select track_stock into v_track from public.products where id = v_pid;
    if v_track then
      insert into public.stock_movements (product_id, qty_delta, reason, ref_type, ref_id)
      values (v_pid, v_qty, 'Purchase: ' || v_supplier || ' bill ' || v_invno, 'purchase', v_bill);
    end if;
  end loop;

  return v_bill;
end;
$$;

create or replace function public.delete_purchase_bill(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_bill public.purchase_bills%rowtype;
  rec    record;
begin
  perform public.require_signed_in();
  select * into v_bill from public.purchase_bills where id = p_id for update;
  if not found then raise exception 'Purchase bill not found.'; end if;

  -- Removing received stock must not push any balance below zero.
  for rec in
    select pr.id as product_id, pr.name,
           sum(m.qty_delta) as net,
           coalesce((select sum(x.qty_delta) from public.stock_movements x where x.product_id = pr.id), 0) as have
    from public.stock_movements m
    join public.products pr on pr.id = m.product_id
    where m.ref_id = p_id and m.ref_type in ('purchase','deletion')
    group by pr.id, pr.name
    having sum(m.qty_delta) <> 0
  loop
    if rec.have - rec.net < 0 then
      raise exception 'Cannot delete this purchase: % has already been sold (% in stock, % received on this bill).',
        rec.name, trim_scale(rec.have), trim_scale(rec.net);
    end if;
    insert into public.stock_movements (product_id, qty_delta, reason, ref_type, ref_id)
    values (rec.product_id, -rec.net, 'Purchase bill deleted: ' || v_bill.supplier_name || ' bill ' || v_bill.supplier_invoice_number, 'deletion', p_id);
  end loop;

  delete from public.purchase_bills where id = p_id;  -- lines cascade
  return v_bill.source_file_path;
end;
$$;

create or replace function public.adjust_stock(p_product_id uuid, p_delta numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_name text;
  v_have numeric;
begin
  perform public.require_signed_in();
  if p_delta is null or p_delta = 0 then raise exception 'Enter a nonzero quantity.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Add a reason for this stock update.'; end if;

  select name into v_name from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;

  select coalesce(sum(qty_delta), 0) into v_have from public.stock_movements where product_id = p_product_id;
  if v_have + p_delta < 0 then
    raise exception 'Stock for % cannot go below zero (% in stock).', v_name, trim_scale(v_have);
  end if;

  insert into public.stock_movements (product_id, qty_delta, reason, ref_type)
  values (p_product_id, p_delta, btrim(p_reason), 'adjustment');
end;
$$;

create or replace function public.clear_product_stock(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare v_have numeric;
begin
  perform public.require_signed_in();
  perform 1 from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;

  select coalesce(sum(qty_delta), 0) into v_have from public.stock_movements where product_id = p_product_id;
  if v_have <> 0 then
    insert into public.stock_movements (product_id, qty_delta, reason, ref_type)
    values (p_product_id, -v_have, 'Stock cleared to zero', 'adjustment');
  end if;
end;
$$;

-- Returns 'deleted' (never used anywhere) or 'archived' (used by a bill or stock history, so only hidden).
create or replace function public.remove_product(p_product_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_signed_in();
  perform 1 from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;

  if exists (select 1 from public.sales_invoice_lines   where product_id = p_product_id)
  or exists (select 1 from public.purchase_bill_lines   where product_id = p_product_id)
  or exists (select 1 from public.stock_movements       where product_id = p_product_id) then
    update public.products set active = false where id = p_product_id;
    return 'archived';
  end if;

  delete from public.products where id = p_product_id;
  return 'deleted';
end;
$$;

-- Fuzzy lookups used by Ask Supra. SECURITY INVOKER: they only read what the signed-in user can already read.
create or replace function public.find_party(q text)
returns table (id uuid, name text, kind text, gstin text, score real, matched_alias text)
language sql
stable
set search_path = public, extensions, pg_catalog
as $$
  select * from (
    select distinct on (c.pid) c.pid as id, c.pname as name, c.pkind as kind, c.pgstin as gstin,
           (case when c.sub then greatest(c.sim, 0.6) else c.sim end)::real as score, c.alias as matched_alias
    from (
      select p.id as pid, p.name as pname, p.kind as pkind, p.gstin as pgstin, null::text as alias,
             similarity(lower(p.name), lower(btrim(q))) as sim,
             strpos(lower(p.name), lower(btrim(q))) > 0 as sub
      from public.parties p
      union all
      select p.id, p.name, p.kind, p.gstin, a.alias,
             similarity(lower(a.alias), lower(btrim(q))),
             strpos(lower(a.alias), lower(btrim(q))) > 0
      from public.party_aliases a join public.parties p on p.id = a.party_id
    ) c
    where btrim(coalesce(q, '')) <> '' and (c.sub or c.sim > 0.2)
    order by c.pid, (case when c.sub then greatest(c.sim, 0.6) else c.sim end) desc
  ) best
  order by best.score desc, best.name
  limit 8;
$$;

create or replace function public.find_product(q text)
returns table (id uuid, name text, hsn text, rate numeric, gst numeric, track_stock boolean, active boolean,
               current_stock numeric, score real, matched_alias text)
language sql
stable
set search_path = public, extensions, pg_catalog
as $$
  select * from (
    select distinct on (c.pid) c.pid as id, c.pname as name, c.phsn as hsn, c.prate as rate, c.pgst as gst,
           c.ptrack as track_stock, c.pactive as active,
           (select coalesce(sum(m.qty_delta), 0) from public.stock_movements m where m.product_id = c.pid) as current_stock,
           (case when c.sub then greatest(c.sim, 0.6) else c.sim end)::real as score, c.alias as matched_alias
    from (
      select p.id as pid, p.name as pname, p.hsn as phsn, p.rate as prate, p.gst as pgst,
             p.track_stock as ptrack, p.active as pactive, null::text as alias,
             similarity(lower(p.name), lower(btrim(q))) as sim,
             strpos(lower(p.name), lower(btrim(q))) > 0 as sub
      from public.products p
      union all
      select p.id, p.name, p.hsn, p.rate, p.gst, p.track_stock, p.active, a.alias,
             similarity(lower(a.alias), lower(btrim(q))),
             strpos(lower(a.alias), lower(btrim(q))) > 0
      from public.product_aliases a join public.products p on p.id = a.product_id
    ) c
    where btrim(coalesce(q, '')) <> '' and (c.sub or c.sim > 0.2)
    order by c.pid, (case when c.sub then greatest(c.sim, 0.6) else c.sim end) desc
  ) best
  order by best.score desc, best.name
  limit 8;
$$;
