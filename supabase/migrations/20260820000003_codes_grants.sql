-- Restrict random_team_code to authenticated users (not anon)
revoke execute on function public.random_team_code() from public, anon;
grant execute on function public.random_team_code() to authenticated, service_role;

-- Redefine both functions without security definer / set search_path
create or replace function public.normalize_code(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create or replace function public.random_team_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), ''
  )
  from generate_series(1, 6)
$$;

grant execute on function public.normalize_code(text) to anon, authenticated, service_role;
