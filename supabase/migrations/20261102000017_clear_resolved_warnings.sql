-- Import warnings are a snapshot of the import-time state. Clear only warnings
-- whose customer and every product line are now linked; preserve real unresolved warnings.
create or replace function public.clear_resolved_import_warnings()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_count integer;
begin
  update public.sales_invoices i
     set import_warning = null
   where i.source = 'excel_import'
     and i.customer_id is not null
     and not exists (select 1 from public.sales_invoice_lines l where l.invoice_id = i.id and l.product_id is null)
     and i.import_warning is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.clear_resolved_import_warnings() to service_role;

-- Clean already-resolved historical rows when this migration is applied.
select public.clear_resolved_import_warnings();
