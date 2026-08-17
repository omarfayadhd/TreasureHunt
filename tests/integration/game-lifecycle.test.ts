import { anonClient, adminClient, serviceClient, resetDb, seedStations, createTeam, setRoute } from './helpers'
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

  it('start_game validates setup completeness step by step', async () => {
    expect(await rpc('start_game')).toEqual({ ok: false, error: 'no_final_station' })
    const stations = await seedStations(service, 2)
    expect(await rpc('start_game')).toEqual({ ok: false, error: 'no_teams' })
    const team = await createTeam(service, 'T1', 'TEAM-11')
    expect(await rpc('start_game')).toEqual({ ok: false, error: 'teams_missing_routes', teams: 1 })
    await setRoute(service, team.id, stations.map(s => s.id))
    expect(await rpc('start_game')).toEqual({ ok: true, status: 'live' })
    const { data: game } = await service.from('game').select('*').single()
    expect(game!.status).toBe('live')
    expect(game!.started_at).not.toBeNull()
    // cannot start twice
    expect(await rpc('start_game')).toEqual({ ok: false, error: 'not_in_setup' })
  })

  it('pause, resume and end follow the allowed transitions', async () => {
    const stations = await seedStations(service, 1)
    const team = await createTeam(service, 'T1', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))

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

  it('reset_progress clears progress but keeps teams, stations and routes', async () => {
    const stations = await seedStations(service, 2)
    const team = await createTeam(service, 'T1', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    await rpc('start_game')
    await service.from('teams').update({ current_position: 3, finished_at: new Date().toISOString() }).eq('id', team.id)
    await service.from('attempts').insert({ team_id: team.id, submitted_code: 'CODE-1', result: 'correct' })

    expect(await rpc('reset_progress')).toEqual({ ok: true, status: 'setup' })

    const { data: teamAfter } = await service.from('teams').select('*').eq('id', team.id).single()
    expect(teamAfter).toMatchObject({ current_position: 0, finished_at: null })
    const { data: attempts } = await service.from('attempts').select('*')
    expect(attempts).toEqual([])
    const { data: stops } = await service.from('route_stops').select('*')
    expect(stops).toHaveLength(3)
    const { data: game } = await service.from('game').select('*').single()
    expect(game).toMatchObject({ status: 'setup', started_at: null, ended_at: null })
  })
})
