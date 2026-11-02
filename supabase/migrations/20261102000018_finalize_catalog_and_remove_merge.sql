-- Finalize the catalog cleanup without leaving a merge feature in the app.
-- This is intentionally a one-time, deterministic data migration.

do $$
declare
  v_target uuid;
  v_source uuid;
begin
  select id into v_target
  from public.parties
  where lower(btrim(name)) = 'mayureshwar book depot'
  limit 1;

  if v_target is not null then
    for v_source in
      select id
      from public.parties
      where id <> v_target
        and lower(btrim(name)) in ('mayuresh book centre', 'mayuresh book depo')
    loop
      update public.sales_invoices
      set customer_id = v_target,
          customer_name = 'Mayureshwar Book Depot',
          customer_gstin = (select gstin from public.parties where id = v_target),
          customer_address1 = (select address1 from public.parties where id = v_target),
          customer_address2 = (select address2 from public.parties where id = v_target)
      where customer_id = v_source;

      update public.purchase_bills
      set supplier_id = v_target,
          supplier_name = 'Mayureshwar Book Depot',
          supplier_gstin = (select gstin from public.parties where id = v_target),
          supplier_address = nullif(btrim(coalesce((select address1 from public.parties where id = v_target), '') || case when nullif(btrim(coalesce((select address2 from public.parties where id = v_target), '')), '') is null then '' else ' ' || btrim((select address2 from public.parties where id = v_target)) end), '')
      where supplier_id = v_source;

      insert into public.party_aliases (party_id, alias)
      select v_target, a.alias
      from public.party_aliases a
      where a.party_id = v_source
        and not exists (select 1 from public.party_aliases x where x.party_id <> v_source and lower(btrim(x.alias)) = lower(btrim(a.alias)));

      insert into public.party_aliases (party_id, alias)
      select v_target, p.name
      from public.parties p
      where p.id = v_source
        and lower(btrim(p.name)) <> 'mayureshwar book depot'
        and not exists (select 1 from public.party_aliases x where lower(btrim(x.alias)) = lower(btrim(p.name)));

      delete from public.party_aliases where party_id = v_source;
      delete from public.parties where id = v_source;
    end loop;

    -- Refresh snapshots after the customer/supplier names and links changed.
    update public.sales_invoice_lines l
    set updated_at = now()
    from public.sales_invoices i
    where l.invoice_id = i.id
      and i.customer_id = v_target;

    update public.purchase_bill_lines l
    set updated_at = now()
    from public.purchase_bills b
    where l.purchase_bill_id = b.id
      and b.supplier_id = v_target;
  end if;
end;
$$;

-- The merge UI and its public RPC surface are removed permanently.
drop function if exists public.merge_customers_bulk(uuid[], uuid, text, text, text, text);
drop function if exists public.merge_products_bulk(uuid[], uuid, text, text, numeric, numeric, boolean);
drop function if exists public.merge_customers(uuid, uuid, text, text, text, text);
drop function if exists public.merge_products(uuid, uuid, text, text, numeric, numeric, boolean);
drop function if exists public._refresh_sales_invoice_json(uuid);
drop function if exists public._refresh_purchase_bill_json(uuid);
