-- Merge duplicate customers/products after catalog cleanup.
-- The selected source record is absorbed into the selected target record.
-- Historical sales, purchases, aliases, stock, and JSON snapshots are updated.

create or replace function public._refresh_sales_invoice_json(p_invoice_id uuid)
returns void language sql security definer set search_path = public, pg_catalog as $$
  update public.sales_invoices i
  set bill_json = jsonb_build_object(
    'id', i.id, 'invoice_no', i.invoice_no, 'invoice_date', i.invoice_date,
    'challan_no', i.challan_no, 'po_no', i.po_no, 'customer_id', i.customer_id,
    'customer_name', i.customer_name, 'customer_gstin', i.customer_gstin,
    'customer_address1', i.customer_address1, 'customer_address2', i.customer_address2,
    'subtotal', i.subtotal, 'cgst', i.cgst, 'sgst', i.sgst, 'round_off', i.round_off,
    'total', i.total, 'status', i.status, 'source', i.source,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'position', l.position, 'product_id', l.product_id, 'description', l.description,
      'hsn', l.hsn, 'gst', l.gst, 'qty', l.qty, 'rate', l.rate, 'amount', l.amount,
      'cgst', l.cgst, 'sgst', l.sgst, 'total', l.total) order by l.position)
      from public.sales_invoice_lines l where l.invoice_id = i.id), '[]'::jsonb)
  ) where i.id = p_invoice_id;
$$;

create or replace function public._refresh_purchase_bill_json(p_bill_id uuid)
returns void language sql security definer set search_path = public, pg_catalog as $$
  update public.purchase_bills b
  set bill_json = jsonb_build_object(
    'id', b.id, 'supplier_id', b.supplier_id, 'supplier_name', b.supplier_name,
    'supplier_gstin', b.supplier_gstin, 'supplier_address', b.supplier_address,
    'supplier_invoice_number', b.supplier_invoice_number, 'purchase_date', b.purchase_date,
    'purchase_order_number', b.purchase_order_number, 'challan_number', b.challan_number,
    'subtotal', b.subtotal, 'tax_total', b.tax_total, 'round_off', b.round_off,
    'grand_total', b.grand_total, 'status', b.status, 'source_file_path', b.source_file_path,
    'extraction_metadata', b.extraction_metadata,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'position', l.position, 'product_id', l.product_id, 'description', l.description,
      'hsn', l.hsn, 'quantity', l.quantity, 'unit', l.unit, 'unit_rate', l.unit_rate,
      'line_total', l.line_total, 'gst_rate', l.gst_rate, 'cgst', l.cgst,
      'sgst', l.sgst, 'igst', l.igst) order by l.position)
      from public.purchase_bill_lines l where l.purchase_bill_id = b.id), '[]'::jsonb)
  ) where b.id = p_bill_id;
$$;

create or replace function public.merge_customers(
  p_source_id uuid, p_target_id uuid, p_name text, p_gstin text default null,
  p_address1 text default null, p_address2 text default null
)
returns void language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_source public.parties%rowtype;
  v_target public.parties%rowtype;
  v_alias text;
  v_id uuid;
begin
  perform public.require_signed_in();
  if p_source_id = p_target_id then raise exception 'Choose two different customers.'; end if;
  select * into v_source from public.parties where id = p_source_id and kind in ('customer','both');
  select * into v_target from public.parties where id = p_target_id and kind in ('customer','both');
  if not found or v_source.id is null or v_target.id is null then raise exception 'Both customers must exist.'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Customer name is required.'; end if;

  update public.sales_invoices
     set customer_id = p_target_id, customer_name = btrim(p_name),
         customer_gstin = nullif(upper(btrim(coalesce(p_gstin, ''))), ''),
         customer_address1 = nullif(btrim(coalesce(p_address1, '')), ''),
         customer_address2 = nullif(btrim(coalesce(p_address2, '')), '')
   where customer_id in (p_source_id, p_target_id);
  update public.purchase_bills
     set supplier_id = p_target_id, supplier_name = btrim(p_name),
         supplier_gstin = nullif(upper(btrim(coalesce(p_gstin, ''))), ''),
         supplier_address = nullif(btrim(coalesce(p_address1, '') || case when nullif(btrim(coalesce(p_address2, '')), '') is null then '' else ' ' || btrim(p_address2) end), '')
   where supplier_id in (p_source_id, p_target_id);

  for v_alias in select name from public.parties where id in (p_source_id, p_target_id)
  loop
    if lower(btrim(v_alias)) <> lower(btrim(p_name)) and not exists (select 1 from public.party_aliases where lower(btrim(alias)) = lower(btrim(v_alias))) then
      insert into public.party_aliases (party_id, alias) values (p_target_id, btrim(v_alias));
    end if;
  end loop;
  for v_alias in select alias from public.party_aliases where party_id = p_source_id
  loop
    if not exists (select 1 from public.party_aliases x where x.party_id <> p_source_id and lower(btrim(x.alias)) = lower(btrim(v_alias))) then
      insert into public.party_aliases (party_id, alias) values (p_target_id, v_alias);
    end if;
  end loop;
  insert into public.party_aliases (party_id, alias) select p_target_id, v_source.name
    where lower(btrim(v_source.name)) <> lower(btrim(p_name))
      and not exists (select 1 from public.party_aliases where lower(btrim(alias)) = lower(btrim(v_source.name)));

  for v_id in select id from public.sales_invoices where customer_id = p_target_id loop perform public._refresh_sales_invoice_json(v_id); end loop;
  delete from public.parties where id = p_source_id;
  update public.parties set name = btrim(p_name), gstin = nullif(upper(btrim(coalesce(p_gstin, ''))), ''), address1 = nullif(btrim(coalesce(p_address1, '')), ''), address2 = nullif(btrim(coalesce(p_address2, '')), '') where id = p_target_id;
end;
$$;

create or replace function public.merge_products(
  p_source_id uuid, p_target_id uuid, p_name text, p_hsn text default '4820',
  p_rate numeric default 0, p_gst numeric default 0, p_track_stock boolean default false
)
returns void language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_source public.products%rowtype;
  v_alias text;
  v_id uuid;
begin
  perform public.require_signed_in();
  if p_source_id = p_target_id then raise exception 'Choose two different products.'; end if;
  select * into v_source from public.products where id = p_source_id;
  if not found then raise exception 'Source product was not found.'; end if;
  if not exists (select 1 from public.products where id = p_target_id) then raise exception 'Target product was not found.'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Product name is required.'; end if;
  if p_rate < 0 or p_gst < 0 or p_gst > 28 then raise exception 'Product rate or GST is invalid.'; end if;

  update public.sales_invoice_lines set product_id = p_target_id, description = btrim(p_name), hsn = nullif(btrim(coalesce(p_hsn, '')), '') where product_id in (p_source_id, p_target_id);
  update public.purchase_bill_lines set product_id = p_target_id, description = btrim(p_name), hsn = nullif(btrim(coalesce(p_hsn, '')), '') where product_id in (p_source_id, p_target_id);
  update public.stock_movements set product_id = p_target_id where product_id = p_source_id;
  update public.products set name = btrim(p_name), hsn = coalesce(nullif(btrim(p_hsn), ''), '4820'), rate = p_rate, gst = p_gst, track_stock = p_track_stock, active = true where id = p_target_id;

  for v_alias in select name from public.products where id in (p_source_id, p_target_id)
  loop
    if lower(btrim(v_alias)) <> lower(btrim(p_name)) and not exists (select 1 from public.product_aliases where lower(btrim(alias)) = lower(btrim(v_alias))) then
      insert into public.product_aliases (product_id, alias) values (p_target_id, btrim(v_alias));
    end if;
  end loop;
  insert into public.product_aliases (product_id, alias) select p_target_id, v_source.name
    where lower(btrim(v_source.name)) <> lower(btrim(p_name))
      and not exists (select 1 from public.product_aliases where lower(btrim(alias)) = lower(btrim(v_source.name)));
  for v_id in select distinct invoice_id from public.sales_invoice_lines where product_id = p_target_id loop perform public._refresh_sales_invoice_json(v_id); end loop;
  for v_id in select distinct purchase_bill_id from public.purchase_bill_lines where product_id = p_target_id loop perform public._refresh_purchase_bill_json(v_id); end loop;
  delete from public.products where id = p_source_id;
end;
$$;

grant execute on function public.merge_customers(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.merge_products(uuid, uuid, text, text, numeric, numeric, boolean) to authenticated;
