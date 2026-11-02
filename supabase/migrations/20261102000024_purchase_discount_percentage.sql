-- Purchase discounts are percentages, not fixed rupee amounts.
alter table public.purchase_bill_lines drop constraint if exists purchase_bill_lines_discount_check;
alter table public.purchase_bill_lines add constraint purchase_bill_lines_discount_check check (discount between 0 and 100);
comment on column public.purchase_bill_lines.discount is 'Per-line purchase discount percentage; does not change the product master rate.';
