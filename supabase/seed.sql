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

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
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
  '{}'::jsonb
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
