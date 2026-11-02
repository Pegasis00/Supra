-- Opening stock is the protected floor for manual reductions.
-- Purchase stock can only be removed by deleting/correcting its purchase bill.

create or replace function public.adjust_stock(p_product_id uuid, p_delta numeric, p_reason text)
returns void language plpgsql security definer
set search_path = public, extensions, pg_catalog as $$
declare
  v_name text;
  v_have numeric;
  v_opening numeric;
begin
  perform public.require_signed_in();
  if p_delta is null or p_delta = 0 then raise exception 'Enter a nonzero quantity.'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Add a reason for this stock update.'; end if;
  select name into v_name from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;
  select coalesce(sum(qty_delta), 0) into v_have from public.stock_movements where product_id = p_product_id;
  select coalesce(sum(qty_delta), 0) into v_opening
  from public.stock_movements
  where product_id = p_product_id
    and ref_type = 'adjustment'
    and lower(reason) like 'opening stock%';
  if v_have + p_delta < v_opening then
    raise exception 'Cannot reduce % below protected opening stock (% units). Purchase stock must be corrected from its purchase bill.', v_name, trim_scale(v_opening);
  end if;
  insert into public.stock_movements (product_id, qty_delta, reason, ref_type)
  values (p_product_id, p_delta, btrim(p_reason), 'adjustment');
end;
$$;
