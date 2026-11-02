-- 0004 reporting views. These nine are the ONLY objects Ask Supra's SQL tool may read.
-- Views run with their owner's rights (so the chat role needs no table access at all).
-- Comments below are sent to the chat model as the schema description, so keep them accurate.

create view public.v_stock as
select p.id as product_id,
       p.name,
       p.active,
       p.track_stock,
       coalesce(sum(m.qty_delta), 0)::numeric(14,3) as stock_qty
from public.products p
left join public.stock_movements m on m.product_id = p.id
group by p.id;
comment on view public.v_stock is 'Current stock per product (sum of the stock ledger). Only meaningful when track_stock is true. This is today''s balance, NOT a historical balance.';

create view public.v_sales_bills as
select i.id,
       i.invoice_no as bill_no,
       i.invoice_date as bill_date,
       i.customer_id as party_id,
       i.customer_name as party_name,
       i.customer_gstin as party_gstin,
       i.customer_address1,
       i.customer_address2,
       i.subtotal, i.cgst, i.sgst, i.round_off, i.total,
       i.status,
       (i.status = 'cancelled') as is_cancelled,
       i.challan_no,
       i.po_no,
       (i.financial_year::text || '-' || lpad(((i.financial_year + 1) % 100)::text, 2, '0')) as financial_year,
       i.source
from public.sales_invoices i;
comment on view public.v_sales_bills is 'One row per sales bill (customer invoice). party_name is the name printed on the bill. Filter is_cancelled = false for real sales. source is app or excel_import (old bills loaded from Excel). Bill numbers repeat only across financial years.';
comment on column public.v_sales_bills.total is 'Grand total after round-off, in rupees.';
comment on column public.v_sales_bills.financial_year is 'Indian financial year April-March, e.g. 2025-26.';

create view public.v_sales_lines as
select l.invoice_id,
       i.invoice_no,
       i.invoice_date,
       (i.status = 'cancelled') as is_cancelled,
       i.customer_name,
       i.customer_gstin,
       l."position",
       l.product_id,
       l.description as product_name,
       l.hsn,
       l.qty as quantity,
       l.rate,
       l.gst as gst_rate,
       l.amount,
       l.cgst,
       l.sgst,
       l.total as line_total,
       (i.financial_year::text || '-' || lpad(((i.financial_year + 1) % 100)::text, 2, '0')) as financial_year
from public.sales_invoice_lines l
join public.sales_invoices i on i.id = l.invoice_id;
comment on view public.v_sales_lines is 'One row per item on a sales bill. product_name is the description printed on the bill (may differ from the current catalog name). Filter is_cancelled = false for real sales.';

create view public.v_purchase_bills as
select b.id,
       b.supplier_id as party_id,
       b.supplier_name as party_name,
       b.supplier_gstin as party_gstin,
       b.supplier_invoice_number as bill_no,
       b.purchase_date as bill_date,
       b.subtotal,
       b.tax_total,
       b.round_off,
       b.grand_total as total,
       b.status,
       (b.status = 'cancelled') as is_cancelled,
       b.purchase_order_number,
       b.challan_number
from public.purchase_bills b;
comment on view public.v_purchase_bills is 'One row per supplier (purchase) bill. bill_no is the supplier''s own bill number (text). Filter is_cancelled = false for real purchases.';

create view public.v_purchase_lines as
select l.purchase_bill_id,
       b.supplier_name,
       b.supplier_invoice_number as bill_no,
       b.purchase_date,
       (b.status = 'cancelled') as is_cancelled,
       l."position",
       l.product_id,
       l.description as product_name,
       l.hsn,
       l.quantity,
       l.unit,
       l.unit_rate,
       l.line_total,
       l.gst_rate,
       l.cgst,
       l.sgst,
       l.igst
from public.purchase_bill_lines l
join public.purchase_bills b on b.id = l.purchase_bill_id;
comment on view public.v_purchase_lines is 'One row per item on a purchase bill, as printed by the supplier.';

create view public.v_party_summary as
select p.id,
       p.kind,
       p.name,
       p.gstin,
       p.address1,
       p.address2,
       p.phone,
       coalesce(s.cnt, 0)   as sales_bill_count,
       coalesce(s.total, 0) as sales_total,
       coalesce(b.cnt, 0)   as purchase_bill_count,
       coalesce(b.total, 0) as purchase_total
from public.parties p
left join (select customer_id, count(*) as cnt,
                  sum(total) filter (where status = 'final') as total
           from public.sales_invoices group by customer_id) s on s.customer_id = p.id
left join (select supplier_id, count(*) as cnt,
                  sum(grand_total) filter (where status = 'confirmed') as total
           from public.purchase_bills group by supplier_id) b on b.supplier_id = p.id;
comment on view public.v_party_summary is 'One row per customer/supplier with bill counts and totals. Counts include cancelled bills; totals include only final sales and confirmed purchases. Bills whose party link is missing are not counted here, query v_sales_bills by party_name instead.';

create view public.v_product_summary as
select p.id,
       p.name,
       p.hsn,
       p.rate,
       p.gst,
       p.track_stock,
       p.active,
       st.stock_qty as current_stock,
       coalesce(sold.qty, 0)   as total_sold,
       coalesce(bought.qty, 0) as total_purchased,
       ls.rate as last_sale_rate,
       lp.unit_rate as last_purchase_rate
from public.products p
join public.v_stock st on st.product_id = p.id
left join (select l.product_id, sum(l.qty) as qty
           from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
           where i.status = 'final' group by l.product_id) sold on sold.product_id = p.id
left join (select l.product_id, sum(l.quantity) as qty
           from public.purchase_bill_lines l join public.purchase_bills b on b.id = l.purchase_bill_id
           where b.status = 'confirmed' group by l.product_id) bought on bought.product_id = p.id
left join lateral (select l.rate
                   from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
                   where l.product_id = p.id and i.status = 'final'
                   order by i.invoice_date desc, i.invoice_no desc limit 1) ls on true
left join lateral (select l.unit_rate
                   from public.purchase_bill_lines l join public.purchase_bills b on b.id = l.purchase_bill_id
                   where l.product_id = p.id and b.status = 'confirmed' and l.unit_rate is not null
                   order by b.purchase_date desc, b.created_at desc limit 1) lp on true;
comment on view public.v_product_summary is 'One row per catalog product: current price list (rate, gst), current stock, lifetime quantities sold/purchased (cancelled bills excluded) and last rates used.';
comment on column public.v_product_summary.rate is 'Current catalog (default) sale rate; the rate actually billed is last_sale_rate or v_sales_lines.rate.';
comment on column public.v_product_summary.current_stock is 'Today''s balance. Only meaningful when track_stock is true.';

create view public.v_monthly_sales as
select date_trunc('month', invoice_date)::date as month_start,
       count(*) as bill_count,
       coalesce(sum(total) filter (where status = 'final'), 0)     as sales_total,
       coalesce(sum(total) filter (where status = 'cancelled'), 0) as cancelled_total
from public.sales_invoices
group by 1;
comment on view public.v_monthly_sales is 'Sales per calendar month. bill_count includes cancelled bills; sales_total is final bills only.';

create view public.v_monthly_purchases as
select date_trunc('month', purchase_date)::date as month_start,
       count(*) as bill_count,
       coalesce(sum(grand_total) filter (where status = 'confirmed'), 0) as purchase_total
from public.purchase_bills
group by 1;
comment on view public.v_monthly_purchases is 'Purchases per calendar month. purchase_total is confirmed bills only.';
