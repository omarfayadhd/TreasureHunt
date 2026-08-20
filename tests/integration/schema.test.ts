import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb, seedStations, createTeam, setRoute, serviceClient } from './helpers'

const service = serviceClient()

beforeEach(async () => {
  await resetDb(service)
})

describe('elimination schema', () => {
  it('defaults a new team to playing with nothing cleared', async () => {
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    expect(team.status).toBe('playing')
    expect(team.current_position).toBe(0)
    expect(team.out_at_level).toBeNull()
  })

  it('rejects an unknown team status', async () => {
    const { error } = await service.from('teams').insert({ name: 'Bad', team_code: 'BAD1', status: 'zombie' })
    expect(error?.message).toMatch(/status/i)
  })

  it('accepts too_late as an attempt result', async () => {
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    const { error } = await service
      .from('attempts')
      .insert({ team_id: team.id, submitted_code: 'NOPE', result: 'too_late' })
    expect(error).toBeNull()
  })

  it('keeps one card_opens row per team and level', async () => {
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await service.from('card_opens').insert({ team_id: team.id, level: 1 })
    const { error } = await service.from('card_opens').insert({ team_id: team.id, level: 1 })
    expect(error?.message).toMatch(/duplicate key/i)
  })

  it('has dropped route_stops', async () => {
    const { error } = await service.from('route_stops').select('*').limit(1)
    expect(error).not.toBeNull()
  })
})

describe('team_stations', () => {
  it('refuses two teams at the same location on the same level', async () => {
    const [s1] = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'AAA111' }])
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: b.id, level: 1, station_id: s1.id, code: 'BBB222' })
    expect(error?.message).toMatch(/duplicate key|unique/i)
  })

  it('allows the same location for another team at a different level', async () => {
    const [s1] = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'AAA111' }])
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: b.id, level: 2, station_id: s1.id, code: 'BBB222' })
    expect(error).toBeNull()
  })

  it('refuses a team revisiting a location', async () => {
    const [s1] = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'AAA111' }])
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: a.id, level: 2, station_id: s1.id, code: 'CCC333' })
    expect(error?.message).toMatch(/duplicate key|unique/i)
  })

  it('refuses a duplicate code across teams', async () => {
    const [s1, s2] = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'SAME11' }])
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: b.id, level: 1, station_id: s2.id, code: 'SAME11' })
    expect(error?.message).toMatch(/duplicate key|unique/i)
  })

  it('refuses a malformed code', async () => {
    const [s1] = await seedStations(service, 1)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const { error } = await service
      .from('team_stations')
      .insert({ team_id: a.id, level: 1, station_id: s1.id, code: 'no good!' })
    expect(error?.message).toMatch(/code/i)
  })

  it('cascades a route away with its team but protects a location in use', async () => {
    const [s1] = await seedStations(service, 1)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, a.id, [{ level: 1, stationId: s1.id, code: 'AAA111' }])
    const { error: stationError } = await service.from('stations').delete().eq('id', s1.id)
    expect(stationError).not.toBeNull()
    await service.from('teams').delete().eq('id', a.id)
    const { data } = await service.from('team_stations').select('*')
    expect(data).toEqual([])
  })

  it('no longer has a code column on stations', async () => {
    const { error } = await service.from('stations').select('code').limit(1)
    expect(error).not.toBeNull()
  })
})
