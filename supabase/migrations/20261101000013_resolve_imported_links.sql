-- Lets a signed-in user attach catalog records to imported sales bills without
-- allowing general edits to historical invoice data from the browser.

create or replace function public.link_imported_sales_customer(p_invoice_id uuid, p_party_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_signed_in();
  if not exists (select 1 from public.parties where id = p_party_id and kind in ('customer', 'both')) then
    raise exception 'Customer was not found.';
  end if;
  update public.sales_invoices
     set customer_id = p_party_id
   where id = p_invoice_id and source = 'excel_import';
  if not found then raise exception 'Imported sales bill was not found.'; end if;
end;
$$;

create or replace function public.link_imported_sales_product(p_line_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_signed_in();
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Product was not found.';
  end if;
  update public.sales_invoice_lines l
     set product_id = p_product_id
    from public.sales_invoices i
   where l.id = p_line_id and l.invoice_id = i.id and i.source = 'excel_import';
  if not found then raise exception 'Imported sales line was not found.'; end if;
end;
$$;

grant execute on function public.link_imported_sales_customer(uuid, uuid) to authenticated;
grant execute on function public.link_imported_sales_product(uuid, uuid) to authenticated;
