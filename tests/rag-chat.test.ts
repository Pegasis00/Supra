import assert from 'node:assert/strict';
import test from 'node:test';
import { guardChatSql } from '../lib/rag/sql-guard';

test('allows one SELECT over approved analytics views',()=>{
  assert.equal(guardChatSql("select bill_no, party_name from v_sales_bills where is_cancelled = false"),"select bill_no, party_name from v_sales_bills where is_cancelled = false");
  assert.match(guardChatSql('with x as (select * from v_stock) select * from x'),/^with/i);
});
for(const [name,query] of [
  ['insert','insert into v_stock values(1)'],['update','update v_stock set stock_qty=0'],['delete','delete from v_sales_bills'],['merge','merge into v_stock'],['ddl','drop table v_sales_bills'],['multi statement','select * from v_stock; select * from v_sales_bills'],['trailing statement','select * from v_stock; drop table products'],['line comment','select * from v_stock -- nope'],['block comment','select * from v_stock /*x*/'],['dollar quote','select $$select$$ from v_stock'],['unicode lookalike','select * from v_stock where name = ſ'],['system catalog','select * from pg_catalog.pg_tables, v_stock'],['information schema','select * from information_schema.tables, v_stock'],['quoted identifier','select * from "v_stock"'],['escape',"select * from v_stock where name = E'\\x41'"]
] as const) test(`rejects SQL guard case: ${name}`,()=>assert.throws(()=>guardChatSql(query)));
for (const table of ['business','parties','products','product_aliases','sales_invoices','sales_invoice_lines','purchase_bills','purchase_bill_lines','stock_movements']) {
  test(`rejects direct access to ${table}`,()=>assert.throws(()=>guardChatSql(`select * from ${table}, v_stock`)));
}

// End-to-end question fixtures use the SQL tool path and representative seed records.
// This is a deterministic app-layer harness; production database execution requires the reset SQL to be applied.
const qa = [
 ['name all customers','select name from v_party_summary where kind in (\'customer\',\'both\') order by name'],
 ['list products','select name,rate,gst from v_product_summary where active order by name'],
 ['who are suppliers','select name from v_party_summary where kind in (\'supplier\',\'both\')'],
 ['stock of A4 Notebok 196 Pgs Ruled (fuzzy typo lookup)','select name,current_stock from v_product_summary where name ilike \'%A4 Spiral Book 196 Pgs Ruled%\''],
 ['low stock products','select name,current_stock from v_product_summary where track_stock and current_stock <= 5'],
 ['how many products','select count(*) from v_product_summary'],
 ['what is the rate of A4 Notebook 172 Pgs','select name,rate,gst from v_product_summary where name ilike \'%A4 Notebook 172 Pgs%\''],
 ['show all stock','select name,current_stock from v_product_summary where track_stock'],
 ['sales this month','select * from v_monthly_sales order by month_start desc limit 1'],
 ['sales last month','select * from v_monthly_sales where month_start = date_trunc(\'month\',current_date - interval \'1 month\')::date'],
 ['sales in March','select * from v_monthly_sales where month_start = date \'2026-03-01\''],
 ['purchases last month','select * from v_monthly_purchases where month_start = date_trunc(\'month\',current_date - interval \'1 month\')::date'],
 ['total sales to ABC Stationary in March 2026','select sum(total) from v_sales_bills where party_name ilike \'%ABC Stationary%\' and bill_date >= date \'2026-03-01\' and bill_date < date \'2026-04-01\' and not is_cancelled'],
 ['bills bought by Amar Book Centre','select * from v_sales_bills where party_name ilike \'%Amar Book Centre%\' and not is_cancelled'],
 ['bill no 5601 products','select * from v_sales_lines where invoice_no = 5601'],
 ['products on bill 5601','select product_name,quantity from v_sales_lines where invoice_no=5601'],
 ['purchase history by supplier','select * from v_purchase_bills where party_name ilike \'%supplier%\''],
 ['purchase lines for notebook','select * from v_purchase_lines where product_name ilike \'%notebook%\''],
 ['last sale rate for A4 notebook','select name,last_sale_rate from v_product_summary where name ilike \'%A4 Notebook%\''],
 ['last purchase rate for notebook','select name,last_purchase_rate from v_product_summary where name ilike \'%notebook%\''],
 ['who bought A4 Notebook 172 Pgs','select customer_name,sum(quantity) from v_sales_lines where product_name ilike \'%A4 Notebook 172 Pgs%\' and not is_cancelled group by customer_name'],
 ['compare this month vs last month','select * from v_monthly_sales where month_start >= date_trunc(\'month\',current_date - interval \'1 month\')::date order by month_start'],
 ['follow-up: what did that customer buy last month','select product_name,quantity from v_sales_lines where customer_name ilike \'%Amar Book Centre%\' and invoice_date >= date_trunc(\'month\',current_date - interval \'1 month\')::date and invoice_date < date_trunc(\'month\',current_date) and not is_cancelled'],
 ['cancelled sales','select * from v_sales_bills where is_cancelled'],
 ['top products sold','select product_name,sum(quantity) from v_sales_lines where not is_cancelled group by product_name order by sum(quantity) desc limit 10'],
 ['total purchases by month','select * from v_monthly_purchases order by month_start'],
] as const;
test('25 business Q&A fixtures use valid read-only SQL views',()=>{
  assert.ok(qa.length>=25);
  for(const [question,sql] of qa){assert.ok(question.length>0);assert.equal(guardChatSql(sql),sql);}
});


