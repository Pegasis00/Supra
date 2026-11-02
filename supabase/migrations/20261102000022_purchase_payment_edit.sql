create or replace function public.update_purchase_bill_payment(p_payment_id uuid, p_amount numeric, p_method text, p_paid_on date, p_note text default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare v_payment public.purchase_bill_payments%rowtype; v_total numeric; v_paid numeric;
begin
  perform public.require_signed_in();
  select * into v_payment from public.purchase_bill_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found.'; end if;
  if p_amount is null or p_amount <= 0 or nullif(btrim(p_method), '') is null or p_paid_on is null then raise exception 'Payment amount, method, and date are required.'; end if;
  select grand_total into v_total from public.purchase_bills where id = v_payment.purchase_bill_id;
  select coalesce(sum(amount), 0) - v_payment.amount into v_paid from public.purchase_bill_payments where purchase_bill_id = v_payment.purchase_bill_id;
  if v_total is null or v_paid + p_amount > v_total then raise exception 'Payment exceeds the remaining balance.'; end if;
  update public.purchase_bill_payments set amount = round(p_amount, 2), method = btrim(p_method), paid_on = p_paid_on, note = nullif(btrim(p_note), '') where id = p_payment_id;
end;
$$;
grant execute on function public.update_purchase_bill_payment(uuid, numeric, text, date, text) to authenticated;
