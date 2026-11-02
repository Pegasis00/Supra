-- 0008 old-bill import. Called by scripts/import-bills/load.ts with the SERVICE ROLE key only
-- (never granted to signed-in app users). Imported bills are tagged source = 'excel_import' and are
-- never written to the stock ledger. Re-running is safe: existing rows are skipped unless p_replace is true,
-- and bills created in the app (source = 'app') are never overwritten.
--
-- Expected shape of p (array of bills):
-- [{ invoice_no, invoice_date, challan_no, po_no, customer_name, customer_gstin, customer_address1,
--    customer_address2, subtotal, cgst, sgst, round_off, total, status, source_file, warnings: [text],
--    items: [{ position, description, hsn, gst, qty, rate, amount, cgst, sgst, total }] }]

create or replace function public.import_sales_invoices(p jsonb, p_batch_id uuid default null, p_replace boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  b                jsonb;
  it               jsonb;
  ord              bigint;
  v_no             integer;
  v_date           date;
  v_fy             integer;
  v_exist          public.sales_invoices%rowtype;
  v_id             uuid;
  v_party          uuid;
  v_pid            uuid;
  v_name           text;
  v_warn           text[];
  v_replacing      boolean;
  n_inserted       integer := 0;
  n_replaced       integer := 0;
  n_skip_existing  integer := 0;
  n_skip_app       integer := 0;
  v_errors         jsonb := '[]'::jsonb;
  v_conflicts      jsonb := '[]'::jsonb;
  v_unm_cust       text[] := '{}';
  v_unm_prod       text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'p must be a JSON array of bills.'; end if;

  for b in select value from jsonb_array_elements(p) loop
    begin
      v_replacing := false;
      v_no   := (b->>'invoice_no')::integer;
      v_date := (b->>'invoice_date')::date;
      v_fy   := (case when extract(month from v_date) >= 4 then extract(year from v_date) else extract(year from v_date) - 1 end)::int;
      v_warn := coalesce(array(select jsonb_array_elements_text(coalesce(b->'warnings', '[]'::jsonb))), '{}');

      select * into v_exist from public.sales_invoices where financial_year = v_fy and invoice_no = v_no;
      if found then
        if v_exist.source = 'app' then
          n_skip_app := n_skip_app + 1;
          v_conflicts := v_conflicts || jsonb_build_object('invoice_no', v_no, 'invoice_date', v_date,
                          'reason', 'A bill with this number was created in the app; not overwritten.');
          continue;
        elsif not p_replace then
          n_skip_existing := n_skip_existing + 1;
          continue;
        end if;
        delete from public.sales_invoices where id = v_exist.id;
        v_replacing := true;
      end if;

      v_name := nullif(btrim(b->>'customer_name'), '');
      v_party := null;
      if v_name is not null then
        select id into v_party from public.parties
         where lower(btrim(name)) = lower(v_name) and kind in ('customer','both');
        if v_party is null then
          select a.party_id into v_party from public.party_aliases a
           where lower(btrim(a.alias)) = lower(v_name);
        end if;
      end if;
      if v_party is null then
        v_unm_cust := v_unm_cust || coalesce(v_name, '(blank)');
        v_warn := array_append(v_warn, 'Customer is not linked to a saved party.'::text);
      end if;

      insert into public.sales_invoices
        (invoice_no, invoice_date, challan_no, po_no, customer_id, customer_name, customer_gstin,
         customer_address1, customer_address2, subtotal, cgst, sgst, round_off, total, status,
         source, source_file, import_warning, import_batch_id)
      values
        (v_no, v_date, nullif(btrim(b->>'challan_no'), ''), nullif(btrim(b->>'po_no'), ''), v_party,
         coalesce(v_name, '(no customer)'), nullif(btrim(b->>'customer_gstin'), ''),
         nullif(btrim(b->>'customer_address1'), ''), nullif(btrim(b->>'customer_address2'), ''),
         (b->>'subtotal')::numeric, (b->>'cgst')::numeric, (b->>'sgst')::numeric,
         coalesce((b->>'round_off')::numeric, 0), (b->>'total')::numeric,
         coalesce(nullif(b->>'status', ''), 'final'),
         'excel_import', nullif(b->>'source_file', ''), nullif(array_to_string(v_warn, ' | '), ''), p_batch_id)
      returning id into v_id;

      for it, ord in select value, ordinality from jsonb_array_elements(b->'items') with ordinality loop
        v_pid := null;
        select id into v_pid from public.products where lower(btrim(name)) = lower(btrim(it->>'description'));
        if v_pid is null then
          select a.product_id into v_pid from public.product_aliases a
           where lower(btrim(a.alias)) = lower(btrim(it->>'description')) limit 1;
        end if;
        if v_pid is null then v_unm_prod := v_unm_prod || btrim(it->>'description'); end if;

        insert into public.sales_invoice_lines
          (invoice_id, position, product_id, description, hsn, gst, qty, rate, amount, cgst, sgst, total)
        values
          (v_id, coalesce(nullif(it->>'position', '')::integer, ord::integer), v_pid, btrim(it->>'description'),
           nullif(btrim(it->>'hsn'), ''), coalesce((it->>'gst')::numeric, 0), (it->>'qty')::numeric,
           (it->>'rate')::numeric, (it->>'amount')::numeric, (it->>'cgst')::numeric, (it->>'sgst')::numeric,
           (it->>'total')::numeric);
      end loop;

      if v_replacing then n_replaced := n_replaced + 1; else n_inserted := n_inserted + 1; end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('invoice_no', b->>'invoice_no', 'source_file', b->>'source_file', 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'inserted', n_inserted,
    'replaced', n_replaced,
    'skipped_existing', n_skip_existing,
    'skipped_app_bills', n_skip_app,
    'conflicts', v_conflicts,
    'errors', v_errors,
    'unmatched_customers', to_jsonb(array(select distinct x from unnest(v_unm_cust) x order by x)),
    'unmatched_products',  to_jsonb(array(select distinct x from unnest(v_unm_prod) x order by x))
  );
end;
$$;

-- After adding new parties/aliases/products, link imported bills that were left unlinked.
create or replace function public.relink_imported_bills()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare n_bills integer; n_lines integer;
begin
  -- Callable by a signed-in user or by the import script (service role).
  if auth.role() is distinct from 'service_role' then perform public.require_signed_in(); end if;

  with m as (
    select i.id as invoice_id,
           coalesce(
             (select p.id from public.parties p where lower(btrim(p.name)) = lower(btrim(i.customer_name)) and p.kind in ('customer','both') limit 1),
             (select a.party_id from public.party_aliases a where lower(btrim(a.alias)) = lower(btrim(i.customer_name)) limit 1)
           ) as party_id
    from public.sales_invoices i
    where i.source = 'excel_import' and i.customer_id is null
  )
  update public.sales_invoices s set customer_id = m.party_id
  from m where s.id = m.invoice_id and m.party_id is not null;
  get diagnostics n_bills = row_count;

  with m as (
    select l.id as line_id,
           coalesce(
             (select p.id from public.products p where lower(btrim(p.name)) = lower(btrim(l.description)) limit 1),
             (select a.product_id from public.product_aliases a where lower(btrim(a.alias)) = lower(btrim(l.description)) limit 1)
           ) as product_id
    from public.sales_invoice_lines l
    join public.sales_invoices i on i.id = l.invoice_id
    where i.source = 'excel_import' and l.product_id is null
  )
  update public.sales_invoice_lines s set product_id = m.product_id
  from m where s.id = m.line_id and m.product_id is not null;
  get diagnostics n_lines = row_count;

  return jsonb_build_object('bills_linked', n_bills, 'lines_linked', n_lines);
end;
$$;
