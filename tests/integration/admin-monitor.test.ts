import { beforeEach, describe, expect, it } from 'vitest'
import {
  adminClient, anonClient, createTeam, resetDb, seedStations, serviceClient, setGameStatus, setRoute,
} from './helpers'

const service = serviceClient()

beforeEach(async () => {
  await resetDb(service)
})

describe('admin_monitor', () => {
  it('reports start, progress, opens and wrong attempts per team', async () => {
    await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await setGameStatus(service, 'live')
    await service.from('card_opens').insert([
      { team_id: a.id, level: 1 },
      { team_id: a.id, level: 2 },
    ])
    await service.from('teams').update({ current_position: 1 }).eq('id', a.id)
    // Only 'wrong' counts: revision 2 never records 'too_late'.
    await service.from('attempts').insert([
      { team_id: a.id, submitted_code: 'CODE1', result: 'correct' },
      { team_id: a.id, submitted_code: 'NOPE1', result: 'wrong' },
      { team_id: a.id, submitted_code: 'NOPE2', result: 'wrong' },
    ])

    const admin = await adminClient()
    const { data, error } = await admin.from('admin_monitor').select('*').order('name')
    expect(error).toBeNull()
    const rows = data as Record<string, unknown>[]
    expect(rows[0]).toMatchObject({
      name: 'Team 1', started: true, max_opened_level: 2, cleared_level: 1, wrong_count: 2,
    })
    expect(rows[0].last_solve_at).not.toBeNull()
    expect(rows[1]).toMatchObject({ name: 'Team 2', started: false, cleared_level: 0, wrong_count: 0 })
    expect(rows[1].max_opened_level).toBeNull()
  })

  it('leaves the vestigial too_late result out of wrong_count', async () => {
    await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await service.from('attempts').insert([
      { team_id: a.id, submitted_code: 'NOPE1', result: 'wrong' },
      { team_id: a.id, submitted_code: 'NOPE2', result: 'too_late' },
      { team_id: a.id, submitted_code: 'CODE1', result: 'already_used' },
    ])

    const admin = await adminClient()
    const { data } = await admin.from('admin_monitor').select('wrong_count').eq('id', a.id).single()
    expect(data).toMatchObject({ wrong_count: 1 })
  })

  it('reports the location each team is hunting', async () => {
    const stations = await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAA111' },
      { level: 2, stationId: stations[1].id, code: 'AAA222' },
      { level: 3, stationId: stations[2].id, code: 'AAA333' },
    ])
    await setGameStatus(service, 'live')
    // Cleared level 1, so the team is hunting its level 2 location.
    await service.from('teams').update({ current_position: 1 }).eq('id', a.id)

    const admin = await adminClient()
    const { data } = await admin.from('admin_monitor').select('name, current_location').order('name')
    expect(data).toMatchObject([{ name: 'Team 1', current_location: 'Station 2' }])
  })

  it('leaves the location empty once a team is past its last level', async () => {
    const stations = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, a.id, [
      { level: 1, stationId: stations[0].id, code: 'AAA111' },
      { level: 2, stationId: stations[1].id, code: 'AAA222' },
    ])
    await service.from('teams')
      .update({ current_position: 2, status: 'winner', finished_at: new Date().toISOString() })
      .eq('id', a.id)

    const admin = await adminClient()
    const { data } = await admin.from('admin_monitor').select('current_location').eq('id', a.id).single()
    expect(data).toMatchObject({ current_location: null })
  })

  it('is not readable anonymously', async () => {
    const { data, error } = await anonClient().from('admin_monitor').select('*')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })
})
