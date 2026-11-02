create table public.purchase_bill_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_bill_id uuid not null references public.purchase_bills(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (btrim(method) <> ''),
  paid_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);
create index purchase_bill_payments_bill_idx on public.purchase_bill_payments(purchase_bill_id, paid_on desc, created_at desc);
alter table public.purchase_bill_payments enable row level security;
create policy purchase_bill_payments_read on public.purchase_bill_payments for select to authenticated using (true);
grant select on public.purchase_bill_payments to authenticated;

create or replace function public.record_purchase_bill_payment(p_bill_id uuid, p_amount numeric, p_method text, p_paid_on date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_bill public.purchase_bills%rowtype; v_paid numeric; v_id uuid;
begin
  perform public.require_signed_in();
  select * into v_bill from public.purchase_bills where id = p_bill_id for update;
  if not found then raise exception 'Purchase bill not found.'; end if;
  if v_bill.status <> 'confirmed' then raise exception 'Payments can only be added to a confirmed purchase bill.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if nullif(btrim(p_method), '') is null or p_paid_on is null then raise exception 'Payment method and date are required.'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.purchase_bill_payments where purchase_bill_id = p_bill_id;
  if v_bill.grand_total is null or v_paid + p_amount > v_bill.grand_total then raise exception 'Payment exceeds the remaining balance.'; end if;
  insert into public.purchase_bill_payments(purchase_bill_id, amount, method, paid_on, note) values (p_bill_id, round(p_amount, 2), btrim(p_method), p_paid_on, nullif(btrim(p_note), '')) returning id into v_id;
  return v_id;
end;
$$;
create or replace function public.delete_purchase_bill_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
begin
  perform public.require_signed_in();
  delete from public.purchase_bill_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found.'; end if;
end;
$$;
grant execute on function public.record_purchase_bill_payment(uuid, numeric, text, date, text) to authenticated;
grant execute on function public.delete_purchase_bill_payment(uuid) to authenticated;
