import { anonClient, adminClient, serviceClient, resetDb, seedStations, createTeam, setRoute } from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

const service = serviceClient()
let admin: SupabaseClient

beforeAll(async () => {
  admin = await adminClient()
})

type Stop = { team_id: string; position: number; station_id: string }

async function routesByTeam(): Promise<Map<string, Stop[]>> {
  const { data } = await service.from('route_stops').select('*').order('position')
  const map = new Map<string, Stop[]>()
  for (const stop of (data as Stop[]) ?? []) {
    if (!map.has(stop.team_id)) map.set(stop.team_id, [])
    map.get(stop.team_id)!.push(stop)
  }
  return map
}

describe('generate_routes', () => {
  beforeEach(() => resetDb(service))

  it('blocks anonymous callers', async () => {
    const { error } = await anonClient().rpc('generate_routes')
    expect(error).not.toBeNull()
  })

  it('requires a final station and at least one regular station', async () => {
    expect((await admin.rpc('generate_routes')).data).toEqual({ ok: false, error: 'no_final_station' })
    await service.from('stations').insert({ name: 'Only final', clue_text: 'x', code: 'FINAL-1', is_final: true })
    expect((await admin.rpc('generate_routes')).data).toEqual({ ok: false, error: 'no_regular_stations' })
  })

  it('gives every team a full route ending at the treasure, with distinct starts', async () => {
    const stations = await seedStations(service, 4)
    const finalId = stations.find(s => s.is_final)!.id
    const allIds = new Set(stations.map(s => s.id))
    for (const [name, code] of [['A', 'TEAM-11'], ['B', 'TEAM-22'], ['C', 'TEAM-33']]) {
      await createTeam(service, name, code)
    }
    const { data } = await admin.rpc('generate_routes')
    expect(data).toEqual({ ok: true, teams_routed: 3 })

    const routes = await routesByTeam()
    expect(routes.size).toBe(3)
    const starts = new Set<string>()
    for (const stops of routes.values()) {
      expect(stops).toHaveLength(5)
      expect(stops[stops.length - 1].station_id).toBe(finalId)
      expect(new Set(stops.map(s => s.station_id))).toEqual(allIds)
      starts.add(stops[0].station_id)
    }
    expect(starts.size).toBe(3) // 3 teams ≤ 4 regular stations → all distinct starts
  })

  it('regenerates everything in setup but only fills gaps when live', async () => {
    const stations = await seedStations(service, 3)
    const teamA = await createTeam(service, 'A', 'TEAM-11')
    await admin.rpc('generate_routes')
    await admin.rpc('start_game')

    const before = [...(await routesByTeam()).get(teamA.id)!.map(s => s.station_id)]
    const teamB = await createTeam(service, 'B', 'TEAM-22')
    const { data } = await admin.rpc('generate_routes')
    expect(data).toEqual({ ok: true, teams_routed: 1 }) // only the new team

    const after = await routesByTeam()
    expect(after.get(teamA.id)!.map(s => s.station_id)).toEqual(before) // untouched
    expect(after.get(teamB.id)).toHaveLength(4)
  })
})

describe('set_team_position', () => {
  beforeEach(() => resetDb(service))

  it('clamps the position and maintains finished_at', async () => {
    const stations = await seedStations(service, 2) // route length 3
    const team = await createTeam(service, 'A', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))

    expect((await admin.rpc('set_team_position', { p_team_id: team.id, p_position: 99 })).data)
      .toEqual({ ok: true, position: 3 })
    const { data: t1 } = await service.from('teams').select('*').eq('id', team.id).single()
    expect(t1!.finished_at).not.toBeNull()

    expect((await admin.rpc('set_team_position', { p_team_id: team.id, p_position: 1 })).data)
      .toEqual({ ok: true, position: 1 })
    const { data: t2 } = await service.from('teams').select('*').eq('id', team.id).single()
    expect(t2!.finished_at).toBeNull()

    expect((await admin.rpc('set_team_position', { p_team_id: team.id, p_position: -5 })).data)
      .toEqual({ ok: true, position: 0 })
  })

  it('rejects unknown teams', async () => {
    const { data } = await admin.rpc('set_team_position', {
      p_team_id: '00000000-0000-0000-0000-000000000000',
      p_position: 1,
    })
    expect(data).toEqual({ ok: false, error: 'invalid_team' })
  })
})
