-- 0001 foundation: extensions, helper functions, default-privilege lockdown.
-- Rule for this folder: never edit a migration that has been pushed. Add a new one instead.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- New public objects must not be open to the API roles by default (Supabase grants them by default).
-- Each migration grants exactly what the app needs.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Used by every SECURITY DEFINER function that changes data.
create or replace function public.require_signed_in()
returns uuid
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;
  return uid;
end;
$$;
