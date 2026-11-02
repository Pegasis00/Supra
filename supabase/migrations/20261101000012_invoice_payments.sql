-- Customer payment ledger for sales invoices.

create table public.invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.sales_invoices(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  method      text not null check (btrim(method) <> ''),
  paid_on     date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);

create index invoice_payments_invoice_idx on public.invoice_payments(invoice_id, paid_on desc, created_at desc);

alter table public.invoice_payments enable row level security;
create policy invoice_payments_read on public.invoice_payments for select to authenticated using (true);
grant select on public.invoice_payments to authenticated;

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_on date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_paid numeric;
  v_id uuid;
begin
  perform public.require_signed_in();
  select * into v_invoice from public.sales_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Bill not found.'; end if;
  if v_invoice.status <> 'final' then raise exception 'Payments can only be added to a final bill.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if nullif(btrim(p_method), '') is null then raise exception 'Choose a payment method.'; end if;
  if p_paid_on is null then raise exception 'Enter the payment date.'; end if;

  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = p_invoice_id;
  if v_paid + p_amount > v_invoice.total then
    raise exception 'Payment exceeds the remaining balance of %.', v_invoice.total - v_paid;
  end if;

  insert into public.invoice_payments(invoice_id, amount, method, paid_on, note)
  values (p_invoice_id, round(p_amount, 2), btrim(p_method), p_paid_on, nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_invoice_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_signed_in();
  delete from public.invoice_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found.'; end if;
end;
$$;

grant execute on function public.record_invoice_payment(uuid, numeric, text, date, text) to authenticated;
grant execute on function public.delete_invoice_payment(uuid) to authenticated;
