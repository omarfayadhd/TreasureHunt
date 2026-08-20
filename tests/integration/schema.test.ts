import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb, seedStations, createTeam, serviceClient } from './helpers'

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

  it('refuses two stations on the same level', async () => {
    await seedStations(service, 2)
    const { error } = await service
      .from('stations')
      .insert({ name: 'Clash', clue_text: 'x', code: 'CLASH1', sort_order: 1 })
    expect(error?.message).toMatch(/duplicate key|unique/i)
  })

  it('refuses a code with punctuation or spaces', async () => {
    const { error } = await service
      .from('stations')
      .insert({ name: 'Bad code', clue_text: 'x', code: 'NOT OK!', sort_order: 9 })
    expect(error?.message).toMatch(/code/i)
  })

  it('has dropped route_stops', async () => {
    const { error } = await service.from('route_stops').select('*').limit(1)
    expect(error).not.toBeNull()
  })
})
