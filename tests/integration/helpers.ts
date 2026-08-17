import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The CLI's well-known local development keys (printed by `supabase status`).
// Override via env vars if your local stack prints different keys.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

const ADMIN_EMAIL = 'admin@test.local'
const ADMIN_PASSWORD = 'test-password-123'

export async function adminClient(): Promise<SupabaseClient> {
  const service = serviceClient()
  const { error } = await service.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
  })
  if (error && !error.message.toLowerCase().includes('already')) throw error
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  if (signInError) throw signInError
  return client
}

function must<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(res.error.message)
  return res
}

export async function resetDb(service: SupabaseClient = serviceClient()): Promise<void> {
  must(await service.from('attempts').delete().gte('id', 0))
  must(await service.from('route_stops').delete().gte('position', 0))
  must(await service.from('teams').delete().gte('created_at', '1970-01-01'))
  must(await service.from('stations').delete().gte('created_at', '1970-01-01'))
  must(await service.from('game').update({ status: 'setup', started_at: null, ended_at: null }).eq('id', 1))
}

export type SeededStation = {
  id: string
  name: string
  clue_text: string
  code: string
  is_final: boolean
  sort_order: number
}

export async function seedStations(service: SupabaseClient, regular: number): Promise<SeededStation[]> {
  const rows = Array.from({ length: regular }, (_, i) => ({
    name: `Station ${i + 1}`,
    clue_text: `Clue leading to station ${i + 1}`,
    code: `CODE-${i + 1}`,
    is_final: false,
    sort_order: i + 1,
  }))
  rows.push({
    name: 'Treasure',
    clue_text: 'Clue leading to the treasure',
    code: 'FINAL-99',
    is_final: true,
    sort_order: regular + 1,
  })
  const { data, error } = await service.from('stations').insert(rows).select()
  if (error) throw new Error(error.message)
  return (data as SeededStation[]).sort((a, b) => a.sort_order - b.sort_order)
}

export async function createTeam(service: SupabaseClient, name: string, code: string) {
  const { data, error } = await service.from('teams').insert({ name, team_code: code }).select().single()
  if (error) throw new Error(error.message)
  return data as { id: string; name: string; team_code: string; current_position: number }
}

export async function setRoute(service: SupabaseClient, teamId: string, stationIds: string[]): Promise<void> {
  const rows = stationIds.map((sid, i) => ({ team_id: teamId, position: i + 1, station_id: sid }))
  must(await service.from('route_stops').insert(rows))
}

export async function setGameStatus(service: SupabaseClient, status: string): Promise<void> {
  must(
    await service
      .from('game')
      .update({ status, started_at: status === 'live' ? new Date().toISOString() : null })
      .eq('id', 1),
  )
}

// Backdates all of a team's attempts so the next submit is not cooldown-blocked.
export async function clearCooldown(service: SupabaseClient, teamId: string): Promise<void> {
  must(
    await service
      .from('attempts')
      .update({ created_at: new Date(Date.now() - 10_000).toISOString() })
      .eq('team_id', teamId),
  )
}
