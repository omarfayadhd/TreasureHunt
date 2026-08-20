import {
  anonClient, adminClient, serviceClient, resetDb, seedStations, createTeam, setRoute, setTreasure,
} from './helpers'
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
    const stations = await seedStations(service, 2)
    const team = await createTeam(service, 'T1', 'TEAM-11')
    await setRoute(service, team.id, [{ level: 1, stationId: stations[0].id, code: 'AAA111' }])
    await setTreasure(service, stations[1].id, 'TREAS9')

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

  it('refuses when the staggered pool is smaller than the field', async () => {
    const admin = await adminClient()
    const stations = await seedStations(service, 2)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    // Two locations, one of them the treasure: only one left for two teams.
    await setTreasure(service, stations[1].id, 'TREAS9')
    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: false, error: 'not_enough_locations', locations: 2, teams: 2 })
  })

  it('refuses when a team has no route at all', async () => {
    const admin = await adminClient()
    const stations = await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAA111' },
      { level: 2, stationId: stations[1].id, code: 'AAA222' },
    ])
    await setTreasure(service, stations[2].id, 'TREAS9')
    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: false, error: 'route_incomplete', team: 'Team 2' })
  })

  it('refuses when a route has a hole in its levels', async () => {
    const admin = await adminClient()
    const stations = await seedStations(service, 4)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAA111' },
      { level: 3, stationId: stations[2].id, code: 'AAA333' },
    ])
    await setTreasure(service, stations[3].id, 'TREAS9')
    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: false, error: 'route_incomplete', team: 'Team 1' })
  })

  it('refuses when the teams have routes of different lengths', async () => {
    const admin = await adminClient()
    const stations = await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAA111' },
      { level: 2, stationId: stations[1].id, code: 'AAA222' },
    ])
    await setRoute(service, b.id, [{ level: 1, stationId: stations[1].id, code: 'BBB111' }])
    await setTreasure(service, stations[2].id, 'TREAS9')
    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: false, error: 'route_length_mismatch' })
  })

  it('starts on a valid rotation and snapshots the team count', async () => {
    const admin = await adminClient()
    const stations = await seedStations(service, 4)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    const c = await createTeam(service, 'Team 3', 'GAMMA3')
    // Routes are shorter than the location pool: two levels each, staggered.
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAA111' },
      { level: 2, stationId: stations[1].id, code: 'AAA222' },
    ])
    await setRoute(service, b.id, [
      { level: 1, stationId: stations[1].id, code: 'BBB111' },
      { level: 2, stationId: stations[2].id, code: 'BBB222' },
    ])
    await setRoute(service, c.id, [
      { level: 1, stationId: stations[2].id, code: 'CCC111' },
      { level: 2, stationId: stations[0].id, code: 'CCC222' },
    ])
    await setTreasure(service, stations[3].id, 'TREAS9')

    // Two staggered legs plus the treasure: three cards to clear.
    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: true, status: 'live', teams: 3, levels: 3 })
    const { data } = await service.from('game').select('initial_team_count').single()
    expect((data as { initial_team_count: number }).initial_team_count).toBe(3)
  })
})

describe('reset_progress', () => {
  beforeEach(() => resetDb(service))

  it('clears statuses, cards and the team-count snapshot', async () => {
    const admin = await adminClient()
    const stations = await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, team.id, [
      { level: 1, stationId: stations[0].id, code: 'AAA111' },
      { level: 2, stationId: stations[1].id, code: 'AAA222' },
    ])
    await setTreasure(service, stations[2].id, 'TREAS9')
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
