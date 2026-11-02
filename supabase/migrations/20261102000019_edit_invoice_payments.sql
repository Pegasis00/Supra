-- Allow payment corrections from the customer-wise receivables ledger.

create or replace function public.update_invoice_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_on date,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_payment public.invoice_payments%rowtype;
  v_invoice public.sales_invoices%rowtype;
  v_other_paid numeric;
begin
  perform public.require_signed_in();
  select * into v_payment from public.invoice_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found.'; end if;
  select * into v_invoice from public.sales_invoices where id = v_payment.invoice_id;
  if not found then raise exception 'Bill not found.'; end if;
  if v_invoice.status <> 'final' then raise exception 'Payments can only be edited on a final bill.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if nullif(btrim(p_method), '') is null then raise exception 'Choose a payment method.'; end if;
  if p_paid_on is null then raise exception 'Enter the payment date.'; end if;
  select coalesce(sum(amount), 0) into v_other_paid from public.invoice_payments where invoice_id = v_payment.invoice_id and id <> p_payment_id;
  if v_other_paid + p_amount > v_invoice.total then raise exception 'Payment exceeds the remaining balance of %.', v_invoice.total - v_other_paid; end if;
  update public.invoice_payments set amount = round(p_amount, 2), method = btrim(p_method), paid_on = p_paid_on, note = nullif(btrim(p_note), '') where id = p_payment_id;
end;
$$;

grant execute on function public.update_invoice_payment(uuid, numeric, text, date, text) to authenticated;
