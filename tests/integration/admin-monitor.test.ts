import { beforeEach, describe, expect, it } from 'vitest'
import { adminClient, anonClient, createTeam, resetDb, seedStations, serviceClient, setGameStatus } from './helpers'

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
    await service.from('attempts').insert([
      { team_id: a.id, submitted_code: 'CODE1', result: 'correct' },
      { team_id: a.id, submitted_code: 'NOPE1', result: 'wrong' },
      { team_id: a.id, submitted_code: 'NOPE2', result: 'too_late' },
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

  it('is not readable anonymously', async () => {
    const { data, error } = await anonClient().from('admin_monitor').select('*')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })
})
