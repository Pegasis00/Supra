-- Allow manual stock corrections to reconcile imported sales and opening stock.
-- The ledger may be reduced below opening/purchase quantities, but never below zero.

create or replace function public.adjust_stock(p_product_id uuid, p_delta numeric, p_reason text)
returns void language plpgsql security definer
set search_path = public, extensions, pg_catalog as $$
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
    raise exception 'Stock for % cannot go below zero (% units).', v_name, trim_scale(v_have);
  end if;
  insert into public.stock_movements (product_id, qty_delta, reason, ref_type)
  values (p_product_id, p_delta, btrim(p_reason), 'adjustment');
end;
$$;
