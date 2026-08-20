import { beforeEach, describe, expect, it } from 'vitest'
import { createTeam, resetDb, seedStations, serviceClient, setRoute } from './helpers'

const service = serviceClient()
beforeEach(async () => { await resetDb(service) })

describe('route seeding helper', () => {
  it('builds a valid rotation for every team with no collisions', async () => {
    const stations = await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')

    const { error } = await service.rpc('seed_missing_routes')
    expect(error).toBeNull()

    const { data } = await service.from('team_stations').select('team_id, level, station_id, code')
    const rows = data as { team_id: string; level: number; station_id: string; code: string }[]
    expect(rows).toHaveLength(6)
    for (const team of [a.id, b.id]) {
      const mine = rows.filter(r => r.team_id === team)
      expect(mine.map(r => r.level).sort()).toEqual([1, 2, 3])
      expect(new Set(mine.map(r => r.station_id)).size).toBe(3)
    }
    for (const level of [1, 2, 3]) {
      const atLevel = rows.filter(r => r.level === level)
      expect(new Set(atLevel.map(r => r.station_id)).size).toBe(atLevel.length)
    }
    expect(new Set(rows.map(r => r.code)).size).toBe(6)
    expect(stations).toHaveLength(3)
  })

  it('is a no-op when routes already exist', async () => {
    await seedStations(service, 2)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await service.rpc('seed_missing_routes')
    const before = (await service.from('team_stations').select('code')).data
    await service.rpc('seed_missing_routes')
    const after = (await service.from('team_stations').select('code')).data
    expect(after).toEqual(before)
  })

  it('refuses when there are fewer locations than teams', async () => {
    await seedStations(service, 1)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    const { data } = await service.rpc('seed_missing_routes')
    expect(data).toMatchObject({ ok: false, error: 'not_enough_locations' })
  })

  it('genuinely staggers a realistic 4-team, 4-location rotation', async () => {
    await seedStations(service, 4)
    const teams = await Promise.all(
      ['Team 1', 'Team 2', 'Team 3', 'Team 4'].map((name, i) =>
        createTeam(service, name, `CODE${i}A`),
      ),
    )

    const { error } = await service.rpc('seed_missing_routes')
    expect(error).toBeNull()

    const { data } = await service.from('team_stations').select('team_id, level, station_id, code')
    const rows = data as { team_id: string; level: number; station_id: string; code: string }[]
    expect(rows).toHaveLength(16)

    for (const team of teams) {
      const mine = rows.filter(r => r.team_id === team.id)
      expect(mine.map(r => r.level).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
      expect(new Set(mine.map(r => r.station_id)).size).toBe(4)
    }

    for (const level of [1, 2, 3, 4]) {
      const atLevel = rows.filter(r => r.level === level)
      expect(atLevel).toHaveLength(4)
      expect(new Set(atLevel.map(r => r.station_id)).size).toBe(4)
    }

    expect(new Set(rows.map(r => r.code)).size).toBe(16)
  })

  it('completes a partial seed around a hand-authored route without touching it', async () => {
    const [k, r, m] = await seedStations(service, 3)
    const owls = await createTeam(service, 'Owls', 'OWLS11')
    const mongooses = await createTeam(service, 'Mongooses', 'MONG22')
    await setRoute(service, owls.id, [
      { level: 1, stationId: k.id, code: 'KITCH1' },
      { level: 2, stationId: r.id, code: 'RECEP2' },
      { level: 3, stationId: m.id, code: 'MEET33' },
    ])
    const before = (await service.from('team_stations').select('*').eq('team_id', owls.id).order('level')).data

    const { data, error } = await service.rpc('seed_missing_routes')
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true })

    const after = (await service.from('team_stations').select('*').eq('team_id', owls.id).order('level')).data
    expect(after).toEqual(before)

    const mongooseRows = (
      await service.from('team_stations').select('level, station_id').eq('team_id', mongooses.id)
    ).data as { level: number; station_id: string }[]
    expect(mongooseRows).toHaveLength(3)
    expect(mongooseRows.map(r => r.level).sort()).toEqual([1, 2, 3])

    const owlRows = after as { level: number; station_id: string }[]
    for (const level of [1, 2, 3]) {
      const owl = owlRows.find(r => r.level === level)?.station_id
      const mongoose = mongooseRows.find(r => r.level === level)?.station_id
      expect(mongoose).not.toBe(owl)
    }
  })

  it('matches the length of a shorter existing route rather than using every location', async () => {
    const stations = await seedStations(service, 4)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAAA11' },
      { level: 2, stationId: stations[1].id, code: 'AAAA22' },
    ])

    const { data, error } = await service.rpc('seed_missing_routes')
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true })

    const bRows = (await service.from('team_stations').select('level').eq('team_id', b.id)).data as { level: number }[]
    expect(bRows.map(r => r.level).sort()).toEqual([1, 2])
  })

  it('refuses to seed when existing teams have uneven route lengths', async () => {
    const stations = await seedStations(service, 4)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    const c = await createTeam(service, 'Team 3', 'GAMMA3')
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAAA11' },
      { level: 2, stationId: stations[1].id, code: 'AAAA22' },
    ])
    await setRoute(service, b.id, [
      { level: 1, stationId: stations[2].id, code: 'BBBB11' },
      { level: 2, stationId: stations[3].id, code: 'BBBB22' },
      { level: 3, stationId: stations[0].id, code: 'BBBB33' },
    ])

    const { data, error } = await service.rpc('seed_missing_routes')
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: false, error: 'existing_routes_uneven' })

    const cRows = (await service.from('team_stations').select('*').eq('team_id', c.id)).data
    expect(cRows).toEqual([])
  })

  it('fails gracefully instead of throwing when no valid rotation exists', async () => {
    const stations = await seedStations(service, 3)
    const [s1, s2, s3] = stations
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    // A's route is a transposition (swap 1st/2nd, fix 3rd) that leaves no valid
    // derangement reachable by a level-by-level greedy scan for the other team.
    await setRoute(service, a.id, [
      { level: 1, stationId: s2.id, code: 'AAAA11' },
      { level: 2, stationId: s1.id, code: 'AAAA22' },
      { level: 3, stationId: s3.id, code: 'AAAA33' },
    ])

    const { data, error } = await service.rpc('seed_missing_routes')
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: false, error: 'no_valid_rotation' })

    const { data: rows } = await service.from('team_stations').select('*')
    expect(rows).toHaveLength(3)
  })
})
