import { anonClient, adminClient, serviceClient, resetDb, seedStations, createTeam } from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

const service = serviceClient()
let admin: SupabaseClient

beforeAll(async () => {
  admin = await adminClient()
})

describe('game lifecycle RPCs', () => {
  beforeEach(() => resetDb(service))

  async function rpc(fn: string) {
    const { data, error } = await admin.rpc(fn)
    expect(error, fn).toBeNull()
    return data
  }

  it('blocks anonymous callers', async () => {
    const { error } = await anonClient().rpc('start_game')
    expect(error).not.toBeNull()
  })

  it('pause, resume and end follow the allowed transitions', async () => {
    await seedStations(service, 1)
    await createTeam(service, 'T1', 'TEAM-11')

    expect(await rpc('pause_game')).toEqual({ ok: false, error: 'not_live' })
    expect(await rpc('resume_game')).toEqual({ ok: false, error: 'not_paused' })
    expect(await rpc('end_game')).toEqual({ ok: false, error: 'not_running' })

    await rpc('start_game')
    expect(await rpc('pause_game')).toEqual({ ok: true, status: 'paused' })
    expect(await rpc('resume_game')).toEqual({ ok: true, status: 'live' })
    expect(await rpc('end_game')).toEqual({ ok: true, status: 'ended' })
    const { data: game } = await service.from('game').select('*').single()
    expect(game!.ended_at).not.toBeNull()
    expect(await rpc('end_game')).toEqual({ ok: false, error: 'not_running' })
  })
})

describe('start_game', () => {
  beforeEach(() => resetDb(service))

  it('refuses with no stations', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    expect(await admin.rpc('start_game').then(r => r.data)).toMatchObject({ ok: false, error: 'no_stations' })
  })

  it('refuses with no teams', async () => {
    const admin = await adminClient()
    await seedStations(service, 2)
    expect(await admin.rpc('start_game').then(r => r.data)).toMatchObject({ ok: false, error: 'no_teams' })
  })

  it('refuses when levels are not contiguous from 1', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    await service.from('stations').insert([
      { name: 'A', clue_text: 'a', code: 'AAA1', sort_order: 1 },
      { name: 'C', clue_text: 'c', code: 'CCC3', sort_order: 3 },
    ])
    expect(await admin.rpc('start_game').then(r => r.data)).toMatchObject({ ok: false, error: 'level_gap' })
  })

  it('starts with mismatched counts and snapshots the team count', async () => {
    const admin = await adminClient()
    await seedStations(service, 2)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 3', 'GAMMA3')

    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: true, status: 'live', teams: 3, levels: 2 })
    const { data } = await service.from('game').select('initial_team_count').single()
    expect((data as { initial_team_count: number }).initial_team_count).toBe(3)
  })
})

describe('reset_progress', () => {
  beforeEach(() => resetDb(service))

  it('clears statuses, cards and the team-count snapshot', async () => {
    const admin = await adminClient()
    await seedStations(service, 2)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await admin.rpc('start_game')
    await service.from('card_opens').insert({ team_id: team.id, level: 1 })
    await service.from('teams')
      .update({ current_position: 2, status: 'winner', finished_at: new Date().toISOString() })
      .eq('id', team.id)

    expect(await admin.rpc('reset_progress').then(r => r.data)).toMatchObject({ ok: true, status: 'setup' })

    const { data: rows } = await service.from('teams').select('current_position, status, finished_at, out_at_level')
    expect(rows).toEqual([{ current_position: 0, status: 'playing', finished_at: null, out_at_level: null }])
    const { data: opens } = await service.from('card_opens').select('*')
    expect(opens).toEqual([])
    const { data: game } = await service.from('game').select('initial_team_count').single()
    expect((game as { initial_team_count: number | null }).initial_team_count).toBeNull()
  })
})
