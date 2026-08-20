-- Local development seed. Runs automatically after migrations on `supabase db reset`
-- (see [db.seed] in config.toml). Never runs against a hosted project.
--
-- Purpose: `db reset` wipes auth.users, which locks you out of the admin UI at
-- http://localhost:5173/admin every time the schema is rebuilt. This recreates a
-- throwaway admin so the local app is usable straight after a reset.
--
-- Credentials are the same throwaway pair the integration tests use
-- (tests/integration/helpers.ts): admin@test.local / test-password-123.
-- Deliberately NOT a real account's password — nothing here should ever be a
-- credential that works anywhere but this machine.

-- The token/change columns MUST be '' rather than NULL. GoTrue scans them into
-- non-nullable Go strings, and a NULL makes every sign-in fail with
-- "Database error querying schema" — which looks like a bad password but is not.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'admin@test.local',
  extensions.crypt('test-password-123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '', '', '', '', '', '', '', ''
where not exists (select 1 from auth.users where email = 'admin@test.local');

-- GoTrue needs a matching identity row before password sign-in will resolve.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, created_at, updated_at
)
select
  'admin@test.local',
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', 'admin@test.local', 'email_verified', true),
  'email',
  now(), now()
from auth.users u
where u.email = 'admin@test.local'
  and not exists (
    select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
  );

-- ---------------------------------------------------------------------------
-- Demo game for local play-testing: 3 teams, 4 locations, staggered 3-level
-- routes with fixed readable codes, and clues that exercise the clue markup.
--
-- Local only: this file is never run against a hosted project (see the header).
-- Fixed codes are the whole point — they are printed here so you can type them
-- on a phone without opening the admin. Never reuse them in a real hunt.
--
-- Each block is guarded on its table being empty, so `db reset` gives a fresh
-- demo game and re-running the seed by hand changes nothing.
-- ---------------------------------------------------------------------------

insert into public.stations (name, clue_text, sort_order)
select v.name, v.clue_text, v.sort_order
from (values
  ('Reception desk', $clue$Two things **begin** your journey:

A letter that follows R,
and a number that comes after 1.

Put them together.
But don't climb yet.

---

**Where are you going?**$clue$, 1),
  ('Kitchen fridge', $clue$Somewhere cold keeps what the morning left behind.

Look where *lunches* chill,
behind the milk nobody claims.

---

**What hums but never sings?**$clue$, 2),
  ('Fire stairwell', $clue$The higher you go,
the more something leaves you behind.

It isn't time.
It isn't money.
But your **body** knows the difference.

---

**Find where the numbers rise while something else falls.**$clue$, 3),
  ('Server cupboard', $clue$A small room that is always *awake*.

It has more fans than a stadium
and not one of them is cheering.

---

**Open the door the badge forgot.**$clue$, 4)
) as v(name, clue_text, sort_order)
where not exists (select 1 from public.stations);

insert into public.teams (name, team_code)
select v.name, v.team_code
from (values
  ('Owls', 'OWLS11'),
  ('Mongooses', 'MONG22'),
  ('Foxes', 'FOXX33')
) as v(name, team_code)
where not exists (select 1 from public.teams);

-- Two staggered legs each: no two teams are at the same place at the same level,
-- and no team walks through the treasure on the way. The third card is the
-- treasure, which is the same place and the same code for everybody.
insert into public.team_stations (team_id, level, station_id, code)
select t.id, v.level, s.id, v.code
from (values
  ('Owls',      1, 'Reception desk', 'RECEP1'),
  ('Owls',      2, 'Kitchen fridge', 'KITCH2'),
  ('Mongooses', 1, 'Kitchen fridge', 'KITCH4'),
  ('Mongooses', 2, 'Fire stairwell', 'STAIR5'),
  ('Foxes',     1, 'Fire stairwell', 'STAIR7'),
  ('Foxes',     2, 'Reception desk', 'RECEP9')
) as v(team_name, level, station_name, code)
join public.teams t on t.name = v.team_name
join public.stations s on s.name = v.station_name
where not exists (select 1 from public.team_stations);

-- The one treasure: same location, same code, every team. First team to send
-- TREAS9 wins; anyone later is told it is gone and keeps hunting none the wiser.
update public.game
set treasure_station_id = (select id from public.stations where name = 'Server cupboard'),
    treasure_code = 'TREAS9'
where id = 1 and treasure_station_id is null;
