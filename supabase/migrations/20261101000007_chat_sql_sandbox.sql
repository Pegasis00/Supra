-- 0007 Ask Supra read-only SQL sandbox.
-- Defence in depth: (1) TypeScript guard (lib/rag/sql-guard.ts), (2) the text checks in chat_run_sql,
-- (3) the query runs as chat_reader, which can read ONLY the nine v_* views (no tables at all),
-- (4) 3-second timeout and a 200-row cap.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'chat_reader') then
    create role chat_reader nologin;
  end if;
end $$;
-- postgres (the migration role) must be able to name chat_reader in a function's SET ROLE clause.
grant chat_reader to postgres;
-- chat_run_sql runs as the signed-in caller but its body executes as chat_reader (function-level SET ROLE).
-- chat_reader has strictly fewer rights than authenticated, so this membership grants nothing extra.
grant chat_reader to authenticated;

grant usage on schema public to chat_reader;
grant select on
  public.v_stock, public.v_sales_lines, public.v_purchase_lines, public.v_sales_bills,
  public.v_purchase_bills, public.v_party_summary, public.v_product_summary,
  public.v_monthly_sales, public.v_monthly_purchases
to chat_reader;

create or replace function public.chat_schema_description()
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'view', c.relname,
           'description', obj_description(c.oid, 'pg_class'),
           'columns', (select jsonb_agg(jsonb_build_object(
                          'name', a.attname,
                          'type', format_type(a.atttypid, a.atttypmod),
                          'comment', col_description(c.oid, a.attnum)) order by a.attnum)
                       from pg_attribute a
                       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
         ) order by c.relname), '[]'::jsonb)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\_%';
$$;

-- SECURITY INVOKER on purpose: PostgreSQL forbids SET ROLE inside SECURITY DEFINER functions, but a function-level
-- "set role" clause is allowed. The whole body, including the user's query, therefore runs as chat_reader.
-- Only authenticated users can call it (no grant to anon), so no extra sign-in check is needed inside.
create or replace function public.chat_run_sql(q text)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
set role = chat_reader
set statement_timeout = '3s'
as $$
declare
  v_views constant text[] := array['v_stock','v_sales_lines','v_purchase_lines','v_sales_bills','v_purchase_bills',
                                   'v_party_summary','v_product_summary','v_monthly_sales','v_monthly_purchases'];
  v_sql    text;
  v_scrub  text;
  v_tok    text;
  v_seen   integer := 0;
  v_res    jsonb;
begin
  if q is null or btrim(q) = '' or length(q) > 12000 or q ~ '[^\x20-\x7e\n\r\t]' then
    raise exception 'Query rejected by SQL safety guard.';
  end if;
  if q ~ '--|/\*|\*/|\$|\\|"' then
    raise exception 'SQL comments, quoting tricks, and escapes are not allowed.';
  end if;

  v_sql := regexp_replace(btrim(q), ';\s*$', '');
  if position(';' in v_sql) > 0 then raise exception 'Only one SQL statement is allowed.'; end if;

  v_scrub := regexp_replace(v_sql, '''(?:[^'']|'''')*''', '''literal''', 'g');
  if v_scrub !~* '^\s*(select|with)\s' then raise exception 'Only SELECT or WITH queries are allowed.'; end if;
  if v_scrub ~* '\m(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|prepare|deallocate|vacuum|analyze|refresh|comment|set|reset|into|lock|listen|notify|pg_[a-z_]*|information_schema|set_config|current_setting|dblink|lo_import|lo_export)\M' then
    raise exception 'Query rejected by SQL safety guard.';
  end if;

  for v_tok in select lower(m[1]) from regexp_matches(v_scrub, '([a-zA-Z_][a-zA-Z0-9_]*)', 'g') as m loop
    if v_tok = any (v_views) then
      v_seen := v_seen + 1;
    elsif v_tok ~ '^v_' then
      raise exception 'Query must read approved analytics views only.';
    elsif exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f') and c.relname = v_tok) then
      raise exception 'Direct base-table access is not allowed.';
    end if;
  end loop;
  if v_seen = 0 then raise exception 'Query must read approved analytics views only.'; end if;

  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from (%s) q limit 200) t', v_sql)
    into v_res;
  return v_res;
end;
$$;
