-- Codes are read off paper and typed on phones: fold away case, spaces and punctuation.
create or replace function public.normalize_code(p text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

grant execute on function public.normalize_code(text) to anon, authenticated, service_role;

-- Excludes I, O, 0, 1 so a handwritten slip can't be misread.
create or replace function public.random_team_code()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), ''
  )
  from generate_series(1, 6)
$$;

grant execute on function public.random_team_code() to authenticated, service_role;
