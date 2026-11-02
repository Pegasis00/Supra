-- 0009 row-level security, grants, storage bucket.
-- Model: one shared business dataset. Any signed-in staff account can read everything.
-- Catalog tables (parties, party_aliases, products, product_aliases) and the business row can be edited directly.
-- Bills, purchase bills and the stock ledger are READ-ONLY from the app; they change only through the RPCs.
-- Convention for future migrations: every new table needs RLS + explicit grants here-style, every new RPC an explicit GRANT EXECUTE.

alter table public.business            enable row level security;
alter table public.parties             enable row level security;
alter table public.party_aliases       enable row level security;
alter table public.products            enable row level security;
alter table public.product_aliases     enable row level security;
alter table public.import_batches      enable row level security;
alter table public.sales_invoices      enable row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.purchase_bills      enable row level security;
alter table public.purchase_bill_lines enable row level security;
alter table public.stock_movements     enable row level security;

-- Start from nothing, then grant exactly what is needed.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on
  public.business, public.parties, public.party_aliases, public.products, public.product_aliases,
  public.import_batches, public.sales_invoices, public.sales_invoice_lines,
  public.purchase_bills, public.purchase_bill_lines, public.stock_movements
to authenticated;
grant insert, update, delete on public.parties, public.party_aliases, public.products, public.product_aliases to authenticated;
grant update on public.business to authenticated;

grant select on
  public.v_stock, public.v_sales_lines, public.v_purchase_lines, public.v_sales_bills, public.v_purchase_bills,
  public.v_party_summary, public.v_product_summary, public.v_monthly_sales, public.v_monthly_purchases
to authenticated;

create policy business_read   on public.business            for select to authenticated using (true);
create policy business_update on public.business            for update to authenticated using (id = 1) with check (id = 1);
create policy parties_all     on public.parties             for all    to authenticated using (true) with check (true);
create policy party_alias_all on public.party_aliases       for all    to authenticated using (true) with check (true);
create policy products_all    on public.products            for all    to authenticated using (true) with check (true);
create policy product_alias_all on public.product_aliases   for all    to authenticated using (true) with check (true);
create policy batches_read    on public.import_batches      for select to authenticated using (true);
create policy sales_read      on public.sales_invoices      for select to authenticated using (true);
create policy sales_lines_read on public.sales_invoice_lines for select to authenticated using (true);
create policy purchase_read   on public.purchase_bills      for select to authenticated using (true);
create policy purchase_lines_read on public.purchase_bill_lines for select to authenticated using (true);
create policy stock_read      on public.stock_movements     for select to authenticated using (true);

-- RPCs the app may call.
grant execute on function
  public.create_invoice(jsonb),
  public.update_invoice(uuid, jsonb),
  public.cancel_invoice(uuid),
  public.delete_invoice(uuid),
  public.confirm_purchase_bill(jsonb),
  public.delete_purchase_bill(uuid),
  public.adjust_stock(uuid, numeric, text),
  public.clear_product_stock(uuid),
  public.remove_product(uuid),
  public.find_party(text),
  public.find_product(text),
  public.chat_schema_description(),
  public.chat_run_sql(text),
  public.relink_imported_bills()
to authenticated;

-- Server-side only (import script uses the service role key).
grant execute on function public.import_sales_invoices(jsonb, uuid, boolean) to service_role;
grant execute on function public.relink_imported_bills() to service_role;

-- Private bucket for uploaded supplier bills: 10 MB, PDF/JPEG/PNG/WebP, each user sees only their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-documents', 'purchase-documents', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy purchase_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy purchase_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'purchase-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy purchase_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
