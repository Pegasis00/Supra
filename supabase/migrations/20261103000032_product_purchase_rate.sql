-- Keep an editable purchase rate on the product catalog for inventory valuation.
-- It is separate from products.rate, which is the suggested selling rate.

alter table public.products
  add column if not exists purchase_rate numeric(12,2) not null default 0
  check (purchase_rate >= 0);

update public.products p
set purchase_rate = coalesce((
  select l.unit_rate
  from public.purchase_bill_lines l
  join public.purchase_bills b on b.id = l.purchase_bill_id
  where l.product_id = p.id
    and b.status = 'confirmed'
    and l.unit_rate is not null
  order by b.purchase_date desc, b.created_at desc
  limit 1
), 0);
