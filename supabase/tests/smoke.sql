-- Smoke test for the whole schema. Runs inside one transaction and rolls back, so it leaves nothing behind.
-- Run against a THROWAWAY database (local Supabase: `npx supabase db reset` then
--   psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2 | tr -d '"')" -f supabase/tests/smoke.sql).
-- Never run this against the real project: it creates and deletes bills inside a rolled-back transaction,
-- but it also temporarily switches roles and calls real functions.
\set ON_ERROR_STOP on
begin;

-- the seed must be loadable twice without changing anything
\i supabase/seed.sql
\i supabase/seed.sql

do $$
declare
  uid uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  v_cust uuid; v_cust_ks uuid; v_prod uuid; v_prod2 uuid; v_inv uuid; v_inv2 uuid; v_bill uuid;
  v_no int; v_n int; v_stock numeric; v_res jsonb; v_msg text; v_total numeric; v_ro numeric;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);

  ------------------------------------------------------------------ seed
  assert (select count(*) from parties) = 49, 'seed: 49 parties';
  assert (select count(*) from party_aliases) = 4, 'seed: 4 aliases';
  assert (select count(*) from products) = 38, 'seed: 38 products';
  assert (select next_invoice_no from business) = 5601, 'seed: counter 5601';
  assert (select rate from products where name = 'A4 Notebook 172 Pgs') = 37.5, 'seed: decimal rate kept';

  ------------------------------------------------------------------ permissions
  set local role authenticated;
  begin
    insert into sales_invoices (invoice_no, invoice_date, customer_name, subtotal, cgst, sgst, round_off, total)
    values (1, current_date, 'x', 0, 0, 0, 0, 0);
    assert false, 'authenticated must not insert invoices directly';
  exception when insufficient_privilege then null; end;
  begin
    delete from stock_movements;
    assert false, 'authenticated must not delete the ledger';
  exception when insufficient_privilege then null; end;
  begin
    perform public.import_sales_invoices('[]'::jsonb);
    assert false, 'authenticated must not run the importer';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from parties) = 49, 'authenticated can read parties';
  reset role;
  set local role anon;
  begin
    perform count(*) from parties;
    assert false, 'anon must not read parties';
  exception when insufficient_privilege then null; end;
  reset role;

  ------------------------------------------------------------------ RPCs need a signed-in user
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.create_invoice('{}'::jsonb);
    assert false, 'must require sign-in';
  exception when others then
    assert sqlerrm = 'Sign in required.', 'sign-in message: ' || sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', uid::text, true);

  ------------------------------------------------------------------ sales flow with stock
  select id into v_cust  from parties where name = 'Amar Book Centre';
  select id into v_prod  from products where name = 'NEET OMR 50 Sheets';
  select id into v_prod2 from products where name = 'A4 Notebook 300 Pgs';
  update products set track_stock = true where id = v_prod;
  perform public.adjust_stock(v_prod, 50, 'Opening balance');
  begin perform public.adjust_stock(v_prod, -51, 'too much'); assert false, 'negative stock';
  exception when others then assert sqlerrm like 'Stock for NEET OMR 50 Sheets cannot go below zero%', sqlerrm; end;

  v_inv := public.create_invoice(jsonb_build_object(
    'invoice_date', '2026-10-20', 'challan_no', '576', 'po_no', '', 'customer_id', v_cust,
    'items', jsonb_build_array(
      jsonb_build_object('product_id', v_prod,  'description', 'NEET OMR 50 Sheets', 'hsn', '4820', 'gst', 0, 'qty', 10, 'rate', 60),
      jsonb_build_object('product_id', null,    'description', 'Custom taxed item',  'hsn', '4820', 'gst', 12, 'qty', 3, 'rate', 33.33))));
  select invoice_no, total, round_off into v_no, v_total, v_ro from sales_invoices where id = v_inv;
  assert v_no = 5601, 'first bill is 5601, got ' || v_no;
  assert v_total = 712 and v_ro = 0.01, format('totals: total %s round_off %s', v_total, v_ro);   -- 600 + 99.99 + 12.00 = 711.99
  assert (select next_invoice_no from business) = 5602, 'counter advanced';
  assert (select customer_name from sales_invoices where id = v_inv) = 'Amar Book Centre', 'snapshot name';
  assert (select count(*) from sales_invoice_lines where invoice_id = v_inv) = 2, 'two lines';
  assert (select stock_qty from v_stock where product_id = v_prod) = 40, 'stock reduced to 40';
  assert (select financial_year from sales_invoices where id = v_inv) = 2026, 'FY 2026';

  begin
    perform public.create_invoice(jsonb_build_object('invoice_date','2026-10-20','customer_id', v_cust,
      'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'description','x','gst',0,'qty',41,'rate',1))));
    assert false, 'oversell must fail';
  exception when others then assert sqlerrm like 'Not enough stock for NEET OMR 50 Sheets%', sqlerrm; end;
  assert (select next_invoice_no from business) = 5602, 'failed bill did not burn a number';

  -- edit: sell 20 instead of 10
  perform public.update_invoice(v_inv, jsonb_build_object('invoice_date','2026-10-21','customer_id', v_cust,
    'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'description','NEET OMR 50 Sheets','hsn','4820','gst',0,'qty',20,'rate',60))));
  assert (select stock_qty from v_stock where product_id = v_prod) = 30, 'stock after edit = 30';
  assert (select total from sales_invoices where id = v_inv) = 1200, 'edited total';
  assert (select invoice_no from sales_invoices where id = v_inv) = 5601, 'number unchanged by edit';
  begin
    perform public.update_invoice(v_inv, jsonb_build_object('invoice_date','2026-10-21','customer_id', v_cust,
      'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'description','a','gst',0,'qty',51,'rate',1))));
    assert false, 'edit oversell must fail';
  exception when others then assert sqlerrm like 'Not enough stock%', sqlerrm; end;
  assert (select stock_qty from v_stock where product_id = v_prod) = 30, 'failed edit left stock alone';

  perform public.cancel_invoice(v_inv);
  assert (select status from sales_invoices where id = v_inv) = 'cancelled', 'cancelled';
  assert (select stock_qty from v_stock where product_id = v_prod) = 50, 'stock restored by cancel';
  begin perform public.cancel_invoice(v_inv); assert false;
  exception when others then assert sqlerrm = 'This bill is already cancelled.', sqlerrm; end;
  begin perform public.update_invoice(v_inv, '{}'::jsonb); assert false;
  exception when others then assert sqlerrm = 'Only final bills can be edited.', sqlerrm; end;
  perform public.delete_invoice(v_inv);
  assert not exists (select 1 from sales_invoices where id = v_inv), 'deleted';
  assert (select stock_qty from v_stock where product_id = v_prod) = 50, 'stock still 50 after delete of a cancelled bill';
  assert (select coalesce(sum(qty_delta),0) from stock_movements where ref_id = v_inv) = 0, 'ledger nets to zero';

  ------------------------------------------------------------------ purchases
  begin
    perform public.confirm_purchase_bill(jsonb_build_object('supplier_name','Paper Mill','supplier_invoice_number','PM-1',
      'purchase_date','2026-10-01','source_reference', other::text || '/f.pdf',
      'items', jsonb_build_array(jsonb_build_object('description','x','quantity',1,'unit_rate',1))));
    assert false, 'foreign document path must fail';
  exception when others then assert sqlerrm like 'The uploaded document does not belong%', sqlerrm; end;

  v_bill := public.confirm_purchase_bill(jsonb_build_object(
    'supplier_name','Paper Mill','supplier_gstin','27abcde1234f1z5','supplier_invoice_number','PM-1','purchase_date','2026-10-01',
    'source_reference', uid::text || '/f.pdf', 'totals', jsonb_build_object('grand_total', 1000),
    'extraction', jsonb_build_object('method','test'),
    'items', jsonb_build_array(
      jsonb_build_object('description','NEET OMR 50 Sheets','quantity',25,'unit_rate',40,'line_total',1000,'gst_rate',0,'product_id',null),
      jsonb_build_object('description','Brand New Pad','quantity',5,'unit_rate',10,'line_total',50,'gst_rate',18))));
  assert (select stock_qty from v_stock where product_id = v_prod) = 75, 'purchase received stock';
  assert exists (select 1 from products where name = 'Brand New Pad' and track_stock), 'new product created, tracked';
  assert (select gstin from parties where name = 'Paper Mill') = '27ABCDE1234F1Z5', 'supplier created with upper-case GSTIN';
  begin
    perform public.confirm_purchase_bill(jsonb_build_object('supplier_name','paper mill','supplier_invoice_number','PM-1','purchase_date','2026-10-02',
      'items', jsonb_build_array(jsonb_build_object('description','x','quantity',1,'unit_rate',1))));
    assert false, 'duplicate supplier bill';
  exception when others then assert sqlerrm like 'Purchase bill PM-1 from paper mill is already recorded%', sqlerrm; end;
  assert (select count(*) from parties where lower(name) = 'paper mill') = 1, 'supplier matched case-insensitively';

  -- sell the received stock so the purchase cannot be deleted
  v_inv2 := public.create_invoice(jsonb_build_object('invoice_date','2026-10-22','customer_id', v_cust,
    'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'description','NEET OMR 50 Sheets','gst',0,'qty',60,'rate',60))));
  begin perform public.delete_purchase_bill(v_bill); assert false;
  exception when others then assert sqlerrm like 'Cannot delete this purchase%', sqlerrm; end;
  perform public.cancel_invoice(v_inv2);
  assert public.delete_purchase_bill(v_bill) = uid::text || '/f.pdf', 'returns source path';
  assert (select stock_qty from v_stock where product_id = v_prod) = 50, 'purchase reversed';

  ------------------------------------------------------------------ stock helpers and product removal
  perform public.clear_product_stock(v_prod);
  assert (select stock_qty from v_stock where product_id = v_prod) = 0, 'cleared';
  assert public.remove_product(v_prod) = 'archived', 'used product is archived';
  assert (select active from products where id = v_prod) = false, 'archived = inactive';
  insert into products (name) values ('Unused Thing');
  assert public.remove_product((select id from products where name = 'Unused Thing')) = 'deleted', 'unused product deleted';

  ------------------------------------------------------------------ lookups
  assert (select name from public.find_party('Amar Book Centr') limit 1) = 'Amar Book Centre', 'fuzzy party';
  assert (select name from public.find_party('Biik Centre') limit 1) = 'K''Sagar Book Centre(N)', 'party found via alias';
  assert (select name from public.find_product('A4 Notbook 300') limit 1) = 'A4 Notebook 300 Pgs', 'fuzzy product';
  assert (select count(*) from public.find_party('')) = 0, 'empty query returns nothing';

  ------------------------------------------------------------------ chat sandbox
  v_res := public.chat_run_sql('select name from v_stock where product_id is not null limit 3');
  assert jsonb_array_length(v_res) = 3, 'chat query works';
  assert jsonb_array_length(public.chat_run_sql('with x as (select * from v_stock) select count(*) as n from x')) = 1, 'WITH works';
  assert current_user = 'postgres' or current_user <> 'chat_reader', 'role reset after chat query';
  foreach v_msg in array array[
    'select * from sales_invoices', 'select * from v_stock; select 1', 'select * from v_stock -- x', 'select 1',
    'delete from v_stock', 'select * from v_stock, parties', 'select pg_sleep(5) from v_stock',
    'select * from v_secret', 'select * from "v_stock"', 'select current_setting(''x'') from v_stock',
    'select * from v_stock into temp t'] loop
    begin perform public.chat_run_sql(v_msg); assert false, 'should reject: ' || v_msg;
    exception when others then assert sqlerrm not like 'should reject%', sqlerrm; end;
  end loop;
  begin
    set local role chat_reader;
    perform count(*) from parties;
    assert false, 'chat_reader must not read tables';
  exception when insufficient_privilege then null; end;
  reset role;
  assert jsonb_array_length(public.chat_schema_description()) = 9, 'nine approved views described';
  assert (public.chat_schema_description()::text) like '%Filter is_cancelled = false%', 'view comments included';

  raise notice 'part 1 ok';
end $$;

------------------------------------------------------------------ old-bill import
do $$
declare
  uid uuid := gen_random_uuid();
  v_batch uuid; v_res jsonb; v_cust uuid; v_prod uuid; v_inv uuid; v_new uuid; v_stock_before numeric;
  v_bills jsonb;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  update business set next_invoice_no = 5601;   -- part 1 advanced the counter
  insert into import_batches (label) values ('test') returning id into v_batch;
  select id into v_cust from parties where name = 'Amar Book Centre';
  select id into v_prod from products where name = 'NEET OMR 50 Sheets';

  -- an app bill takes number 5601 in FY 2026
  update products set active = true, track_stock = true where id = v_prod;
  perform public.adjust_stock(v_prod, 100, 'opening');
  v_inv := public.create_invoice(jsonb_build_object('invoice_date','2026-10-20','customer_id', v_cust,
    'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'description','NEET OMR 50 Sheets','gst',0,'qty',5,'rate',60))));
  assert (select invoice_no from sales_invoices where id = v_inv) = 5601, 'app bill 5601 (FY 2026)';

  v_bills := jsonb_build_array(
    -- same number, previous financial year: allowed
    jsonb_build_object('invoice_no',5601,'invoice_date','2025-06-12','customer_name','K ''Sagar Book Centre(J)','customer_address1','Appa Balwant Chowk','customer_address2','Pune',
      'subtotal',600,'cgst',0,'sgst',0,'round_off',0,'total',600,'status','final','source_file','a.xlsx#Invoice','warnings',jsonb_build_array('printed total differs'),
      'items', jsonb_build_array(jsonb_build_object('position',1,'description','NEET OMR 50 Sheets','hsn','4820','gst',0,'qty',10,'rate',60,'amount',600,'cgst',0,'sgst',0,'total',600))),
    -- same number AND financial year as the app bill: must be skipped
    jsonb_build_object('invoice_no',5601,'invoice_date','2026-05-01','customer_name','Amar Book Centre','subtotal',10,'cgst',0,'sgst',0,'round_off',0,'total',10,
      'items', jsonb_build_array(jsonb_build_object('description','x','qty',1,'rate',10,'amount',10,'cgst',0,'sgst',0,'total',10))),
    -- unknown customer and unknown product, with GST
    jsonb_build_object('invoice_no',5400,'invoice_date','2026-01-05','customer_name','Brand New Customer','subtotal',100,'cgst',6,'sgst',6,'round_off',0.00,'total',112,
      'items', jsonb_build_array(jsonb_build_object('description','Mystery Item','hsn','4820','gst',12,'qty',2,'rate',50,'amount',100,'cgst',6,'sgst',6,'total',112))),
    -- inconsistent totals: must fail alone, without affecting the others
    jsonb_build_object('invoice_no',5401,'invoice_date','2026-01-06','customer_name','Amar Book Centre','subtotal',100,'cgst',0,'sgst',0,'round_off',0,'total',999,
      'items', jsonb_build_array(jsonb_build_object('description','x','qty',1,'rate',100,'amount',100,'cgst',0,'sgst',0,'total',100))));

  v_res := public.import_sales_invoices(v_bills, v_batch);
  assert (v_res->>'inserted')::int = 2, 'inserted 2: ' || v_res::text;
  assert (v_res->>'skipped_app_bills')::int = 1, 'app bill not overwritten: ' || v_res::text;
  assert jsonb_array_length(v_res->'errors') = 1, 'one bad bill reported: ' || v_res::text;
  assert (v_res->'unmatched_customers') = '["Brand New Customer"]'::jsonb, 'unmatched customer listed: ' || v_res::text;
  assert (v_res->'unmatched_products') = '["Mystery Item"]'::jsonb, 'unmatched product listed: ' || v_res::text;
  assert (select count(*) from sales_invoices where source = 'excel_import') = 2, 'two imported rows';
  assert (select customer_id from sales_invoices where invoice_no = 5601 and financial_year = 2025) =
         (select id from parties where name = 'K''Sagar Book Centre(J)'), 'alias linked old bill to canonical customer';
  assert (select financial_year from v_sales_bills where bill_no = 5601 and source = 'excel_import') = '2025-26', 'view FY label';
  assert (select import_warning from sales_invoices where invoice_no = 5400) like 'Customer is not linked%', 'warning stored';
  assert (select count(*) from stock_movements where ref_id in (select id from sales_invoices where source = 'excel_import')) = 0, 'import never touches stock';

  -- idempotent re-run
  v_res := public.import_sales_invoices(v_bills, v_batch);
  assert (v_res->>'inserted')::int = 0 and (v_res->>'skipped_existing')::int = 2, 're-run skips existing: ' || v_res::text;
  v_res := public.import_sales_invoices(v_bills, v_batch, true);
  assert (v_res->>'replaced')::int = 2, 'replace mode replaces imported rows only: ' || v_res::text;
  assert exists (select 1 from sales_invoices where id = v_inv and source = 'app' and status = 'final' and total = 300), 'app bill intact';

  -- relink after the customer is added
  insert into parties (kind, name) values ('customer', 'Brand New Customer');
  v_res := public.relink_imported_bills();
  assert (v_res->>'bills_linked')::int = 1, 'relinked: ' || v_res::text;

  -- editing an imported bill must not touch stock
  select id into v_new from sales_invoices where invoice_no = 5601 and financial_year = 2025;
  select stock_qty into v_stock_before from v_stock where product_id = v_prod;
  perform public.update_invoice(v_new, jsonb_build_object('invoice_date','2025-06-12','customer_id', v_cust,
    'items', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'description','NEET OMR 50 Sheets','gst',0,'qty',90,'rate',60))));
  assert (select stock_qty from v_stock where product_id = v_prod) = v_stock_before, 'editing imported bill left stock alone';
  perform public.cancel_invoice(v_new);
  perform public.delete_invoice(v_new);
  assert (select stock_qty from v_stock where product_id = v_prod) = v_stock_before, 'cancel/delete imported bill left stock alone';

  -- the next app bill skips taken numbers: pretend the counter was reset to 5601
  update business set next_invoice_no = 5601;
  v_inv := public.create_invoice(jsonb_build_object('invoice_date','2026-10-23','customer_id', v_cust,
    'items', jsonb_build_array(jsonb_build_object('product_id', null, 'description','Pen','gst',0,'qty',1,'rate',10))));
  assert (select invoice_no from sales_invoices where id = v_inv) = 5603, 'counter skipped taken numbers 5601 and 5602 in this FY';

  -- reporting views
  assert (select count(*) from v_monthly_sales) >= 2, 'monthly sales view works';
  assert (select count(*) from v_party_summary) >= 49, 'party summary view works';
  assert (select count(*) from v_product_summary) >= 38, 'product summary view works';
  assert exists (select 1 from storage.buckets where id = 'purchase-documents' and public = false), 'bucket private';
  raise notice 'part 2 ok';
end $$;

rollback;
\echo ALL SMOKE TESTS PASSED
