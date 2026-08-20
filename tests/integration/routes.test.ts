import { beforeEach, describe, expect, it } from 'vitest'
import { createTeam, resetDb, seedStations, serviceClient } from './helpers'

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
})
