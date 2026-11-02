-- Manual inventory adjustments may not consume stock received through purchase bills.
-- Purchase quantities can only be removed by deleting/correcting the purchase bill.

create or replace function public.adjust_stock(p_product_id uuid, p_delta numeric, p_reason text)
returns void language plpgsql security definer
set search_path = public, extensions, pg_catalog as $$
declare
  v_name text;
  v_have numeric;
  v_protected numeric;
begin
  perform public.require_signed_in();
  if p_delta is null or p_delta = 0 then raise exception 'Enter a nonzero quantity.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Add a reason for this stock update.'; end if;
  select name into v_name from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;

  select coalesce(sum(qty_delta), 0) into v_have
  from public.stock_movements where product_id = p_product_id;
  select coalesce(sum(qty_delta), 0) into v_protected
  from public.stock_movements
  where product_id = p_product_id
    and (ref_type = 'adjustment' and lower(reason) like 'opening stock%'
         or ref_type in ('purchase', 'deletion'));

  if v_have + p_delta < v_protected then
    raise exception 'Cannot reduce % below protected stock (% units). Reduce purchase stock by editing or deleting its purchase bill.', v_name, trim_scale(v_protected);
  end if;
  insert into public.stock_movements (product_id, qty_delta, reason, ref_type)
  values (p_product_id, p_delta, btrim(p_reason), 'adjustment');
end;
$$;
