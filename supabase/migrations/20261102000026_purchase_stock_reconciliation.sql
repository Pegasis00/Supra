-- Every product appearing on a confirmed purchase is inventory-managed.
-- This also repairs older purchase bills that were saved before this rule existed.

update public.products p
set track_stock = true
where exists (
  select 1 from public.purchase_bill_lines l
  join public.purchase_bills b on b.id = l.purchase_bill_id
  where l.product_id = p.id and b.status = 'confirmed'
);

insert into public.stock_movements (product_id, qty_delta, reason, ref_type, ref_id)
select l.product_id,
       sum(l.quantity),
       'Purchase: ' || b.supplier_name || ' bill ' || b.supplier_invoice_number,
       'purchase',
       b.id
from public.purchase_bill_lines l
join public.purchase_bills b on b.id = l.purchase_bill_id
where b.status = 'confirmed'
  and not exists (
    select 1 from public.stock_movements m
    where m.ref_id = b.id and m.ref_type = 'purchase' and m.product_id = l.product_id
  )
group by l.product_id, b.id, b.supplier_name, b.supplier_invoice_number;

create or replace function public.mark_purchased_product_as_stock_tracked()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  update public.products set track_stock = true where id = new.product_id;
  return new;
end;
$$;

drop trigger if exists purchase_line_marks_stock on public.purchase_bill_lines;
create trigger purchase_line_marks_stock
after insert on public.purchase_bill_lines
for each row execute function public.mark_purchased_product_as_stock_tracked();
