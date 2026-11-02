-- Bulk merge wrapper used by the catalog card menus. The existing single-merge
-- functions perform the actual guarded updates; this lets the user absorb
-- several duplicate records into one selected record in one transaction.

create or replace function public.merge_customers_bulk(
  p_source_ids uuid[], p_target_id uuid, p_name text, p_gstin text default null,
  p_address1 text default null, p_address2 text default null
)
returns void language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_source uuid;
begin
  perform public.require_signed_in();
  foreach v_source in array coalesce(p_source_ids, '{}'::uuid[]) loop
    if v_source <> p_target_id then
      perform public.merge_customers(v_source, p_target_id, p_name, p_gstin, p_address1, p_address2);
    end if;
  end loop;
end;
$$;

create or replace function public.merge_products_bulk(
  p_source_ids uuid[], p_target_id uuid, p_name text, p_hsn text default '4820',
  p_rate numeric default 0, p_gst numeric default 0, p_track_stock boolean default false
)
returns void language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_source uuid;
begin
  perform public.require_signed_in();
  foreach v_source in array coalesce(p_source_ids, '{}'::uuid[]) loop
    if v_source <> p_target_id then
      perform public.merge_products(v_source, p_target_id, p_name, p_hsn, p_rate, p_gst, p_track_stock);
    end if;
  end loop;
end;
$$;

grant execute on function public.merge_customers_bulk(uuid[], uuid, text, text, text, text) to authenticated;
grant execute on function public.merge_products_bulk(uuid[], uuid, text, text, numeric, numeric, boolean) to authenticated;
