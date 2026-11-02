-- 0005 sales RPCs. The app never writes sales tables directly; it calls these.
-- All are SECURITY DEFINER with a fixed search_path and require a signed-in user.
-- The business row is locked while an invoice is written, which serialises invoice writes
-- (gap-free numbering and no two bills selling the same stock at once).

-- Validates the items array and computes every line with the same rounding the app uses
-- (lib/money.ts calcLine): amount = round(qty*rate,2); cgst = sgst = round(amount*gst/200,2).
create or replace function public._invoice_lines(p_items jsonb)
returns setof public.sales_invoice_lines
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  it    jsonb;
  ord   bigint;
  r     public.sales_invoice_lines;
  v_pid uuid;
  v_gst numeric;
  v_qty numeric;
  v_rate numeric;
  v_desc text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item.';
  end if;

  for it, ord in select value, ordinality from jsonb_array_elements(p_items) with ordinality loop
    v_desc := nullif(btrim(it->>'description'), '');
    v_qty  := nullif(it->>'qty', '')::numeric;
    v_rate := nullif(it->>'rate', '')::numeric;
    v_gst  := coalesce(nullif(it->>'gst', '')::numeric, 0);
    v_pid  := nullif(it->>'product_id', '')::uuid;

    if v_desc is null then raise exception 'Item % needs a description.', ord; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Item % needs a quantity greater than zero.', ord; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Item % needs a rate.', ord; end if;
    if v_gst < 0 or v_gst > 28 then raise exception 'Item % has an invalid GST percentage.', ord; end if;
    if v_pid is not null and not exists (select 1 from public.products where id = v_pid) then
      raise exception 'Item % refers to a product that no longer exists.', ord;
    end if;

    r := null;
    r.position    := ord::int;
    r.product_id  := v_pid;
    r.description := v_desc;
    r.hsn         := coalesce(nullif(btrim(it->>'hsn'), ''), '4820');
    r.gst         := v_gst;
    r.qty         := v_qty;
    r.rate        := v_rate;
    r.amount      := round(v_qty * v_rate, 2);
    r.cgst        := round(r.amount * v_gst / 200, 2);
    r.sgst        := r.cgst;
    r.total       := r.amount + r.cgst + r.sgst;
    return next r;
  end loop;
end;
$$;

-- Writes the opposite of whatever stock this bill still has out. Safe to call twice (net becomes zero).
create or replace function public._reverse_invoice_stock(p_invoice_id uuid, p_invoice_no integer, p_reason text)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare rec record;
begin
  for rec in
    select m.product_id, sum(m.qty_delta) as net
    from public.stock_movements m
    where m.ref_id = p_invoice_id and m.ref_type in ('sale','deletion')
    group by m.product_id
    having sum(m.qty_delta) <> 0
  loop
    insert into public.stock_movements (product_id, qty_delta, reason, ref_type, ref_id)
    values (rec.product_id, -rec.net, p_reason || ' (invoice #' || p_invoice_no || ')', 'deletion', p_invoice_id);
  end loop;
end;
$$;

create or replace function public.create_invoice(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_cust   public.parties%rowtype;
  v_date   date;
  v_no     integer;
  v_fy     integer;
  v_id     uuid := gen_random_uuid();
  v_lines  public.sales_invoice_lines[];
  v_sub    numeric;
  v_tax    numeric;
  v_exact  numeric;
  v_total  numeric;
  rec      record;
begin
  perform public.require_signed_in();

  select * into v_cust from public.parties
   where id = nullif(p->>'customer_id', '')::uuid and kind in ('customer','both');
  if not found then raise exception 'Choose a valid customer.'; end if;

  v_date := nullif(p->>'invoice_date', '')::date;
  if v_date is null then raise exception 'Enter the bill date.'; end if;

  select next_invoice_no into v_no from public.business where id = 1 for update;
  if not found then raise exception 'Business settings are missing. Open Settings and save them first.'; end if;

  select array_agg(l) into v_lines from public._invoice_lines(p->'items') l;

  -- Tracked products cannot be sold below available stock.
  for rec in
    select pr.name, sum(u.qty) as need,
           coalesce((select sum(m.qty_delta) from public.stock_movements m where m.product_id = pr.id), 0) as have
    from unnest(v_lines) u
    join public.products pr on pr.id = u.product_id and pr.track_stock
    group by pr.id, pr.name
  loop
    if rec.need > rec.have then
      raise exception 'Not enough stock for %: % available, % needed.', rec.name, trim_scale(rec.have), trim_scale(rec.need);
    end if;
  end loop;

  select coalesce(sum(u.amount), 0), coalesce(sum(u.cgst), 0) into v_sub, v_tax from unnest(v_lines) u;
  v_exact := v_sub + 2 * v_tax;
  v_total := round(v_exact);

  -- Numbers are unique per financial year. Skip any number already taken (for example by imported bills).
  v_fy := (case when extract(month from v_date) >= 4 then extract(year from v_date) else extract(year from v_date) - 1 end)::int;
  while exists (select 1 from public.sales_invoices where financial_year = v_fy and invoice_no = v_no) loop
    v_no := v_no + 1;
  end loop;

  insert into public.sales_invoices
    (id, invoice_no, invoice_date, challan_no, po_no, customer_id, customer_name, customer_gstin,
     customer_address1, customer_address2, subtotal, cgst, sgst, round_off, total, status, source)
  values
    (v_id, v_no, v_date, nullif(btrim(p->>'challan_no'), ''), nullif(btrim(p->>'po_no'), ''), v_cust.id, v_cust.name, v_cust.gstin,
     v_cust.address1, v_cust.address2, v_sub, v_tax, v_tax, round(v_total - v_exact, 2), v_total, 'final', 'app');

  insert into public.sales_invoice_lines
    (invoice_id, position, product_id, description, hsn, gst, qty, rate, amount, cgst, sgst, total)
  select v_id, u.position, u.product_id, u.description, u.hsn, u.gst, u.qty, u.rate, u.amount, u.cgst, u.sgst, u.total
  from unnest(v_lines) u;

  insert into public.stock_movements (product_id, qty_delta, reason, ref_type, ref_id)
  select u.product_id, -u.qty, 'Sale: invoice #' || v_no, 'sale', v_id
  from unnest(v_lines) u
  join public.products pr on pr.id = u.product_id and pr.track_stock;

  update public.business set next_invoice_no = v_no + 1 where id = 1;
  return v_id;
end;
$$;

create or replace function public.update_invoice(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_inv    public.sales_invoices%rowtype;
  v_cust   public.parties%rowtype;
  v_date   date;
  v_lines  public.sales_invoice_lines[];
  v_sub    numeric;
  v_tax    numeric;
  v_exact  numeric;
  v_total  numeric;
  rec      record;
begin
  perform public.require_signed_in();
  perform 1 from public.business where id = 1 for update;

  select * into v_inv from public.sales_invoices where id = p_id for update;
  if not found then raise exception 'Bill not found.'; end if;
  if v_inv.status <> 'final' then raise exception 'Only final bills can be edited.'; end if;

  select * into v_cust from public.parties
   where id = nullif(p->>'customer_id', '')::uuid and kind in ('customer','both');
  if not found then raise exception 'Choose a valid customer.'; end if;

  v_date := nullif(p->>'invoice_date', '')::date;
  if v_date is null then raise exception 'Enter the bill date.'; end if;

  select array_agg(l) into v_lines from public._invoice_lines(p->'items') l;

  -- Old bills imported from Excel were never part of the stock ledger, so editing them must not touch stock.
  if v_inv.source = 'app' then
    for rec in
      select pr.name, sum(u.qty) as need,
             coalesce((select sum(m.qty_delta) from public.stock_movements m where m.product_id = pr.id), 0)
           + coalesce((select -sum(m.qty_delta) from public.stock_movements m
                        where m.product_id = pr.id and m.ref_id = p_id and m.ref_type in ('sale','deletion')), 0) as have
      from unnest(v_lines) u
      join public.products pr on pr.id = u.product_id and pr.track_stock
      group by pr.id, pr.name
    loop
      if rec.need > rec.have then
        raise exception 'Not enough stock for %: % available, % needed.', rec.name, trim_scale(rec.have), trim_scale(rec.need);
      end if;
    end loop;

    perform public._reverse_invoice_stock(p_id, v_inv.invoice_no, 'Bill edited: previous stock reversed');

    insert into public.stock_movements (product_id, qty_delta, reason, ref_type, ref_id)
    select u.product_id, -u.qty, 'Sale: invoice #' || v_inv.invoice_no || ' (edited)', 'sale', p_id
    from unnest(v_lines) u
    join public.products pr on pr.id = u.product_id and pr.track_stock;
  end if;

  select coalesce(sum(u.amount), 0), coalesce(sum(u.cgst), 0) into v_sub, v_tax from unnest(v_lines) u;
  v_exact := v_sub + 2 * v_tax;
  v_total := round(v_exact);

  begin
    update public.sales_invoices set
      invoice_date = v_date,
      challan_no = nullif(btrim(p->>'challan_no'), ''),
      po_no = nullif(btrim(p->>'po_no'), ''),
      customer_id = v_cust.id,
      customer_name = v_cust.name,
      customer_gstin = v_cust.gstin,
      customer_address1 = v_cust.address1,
      customer_address2 = v_cust.address2,
      subtotal = v_sub, cgst = v_tax, sgst = v_tax,
      round_off = round(v_total - v_exact, 2),
      total = v_total
    where id = p_id;
  exception when unique_violation then
    raise exception 'Invoice number % already exists in the financial year of that date.', v_inv.invoice_no;
  end;

  delete from public.sales_invoice_lines where invoice_id = p_id;
  insert into public.sales_invoice_lines
    (invoice_id, position, product_id, description, hsn, gst, qty, rate, amount, cgst, sgst, total)
  select p_id, u.position, u.product_id, u.description, u.hsn, u.gst, u.qty, u.rate, u.amount, u.cgst, u.sgst, u.total
  from unnest(v_lines) u;
end;
$$;

create or replace function public.cancel_invoice(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare v_inv public.sales_invoices%rowtype;
begin
  perform public.require_signed_in();
  select * into v_inv from public.sales_invoices where id = p_id for update;
  if not found then raise exception 'Bill not found.'; end if;
  if v_inv.status = 'cancelled' then raise exception 'This bill is already cancelled.'; end if;

  update public.sales_invoices set status = 'cancelled' where id = p_id;
  perform public._reverse_invoice_stock(p_id, v_inv.invoice_no, 'Bill cancelled');
end;
$$;

create or replace function public.delete_invoice(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare v_inv public.sales_invoices%rowtype;
begin
  perform public.require_signed_in();
  select * into v_inv from public.sales_invoices where id = p_id for update;
  if not found then raise exception 'Bill not found.'; end if;

  perform public._reverse_invoice_stock(p_id, v_inv.invoice_no, 'Bill deleted');
  delete from public.sales_invoices where id = p_id;  -- lines cascade
end;
$$;
