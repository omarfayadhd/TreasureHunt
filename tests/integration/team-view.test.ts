import { beforeEach, describe, expect, it } from 'vitest'
import { anonClient, createTeam, resetDb, seedStations, serviceClient, setGameStatus } from './helpers'

const service = serviceClient()
const anon = anonClient()

type Card = { level: number; unlocked: boolean; opened: boolean; clue: string | null }
type View = {
  ok: boolean
  team_name: string
  status: string
  cleared: number
  total: number
  place: number | null
  out_at_level: number | null
  race: { level: number; found: number; teams: number } | null
  cards: Card[]
}

async function view(code: string): Promise<View> {
  const { data, error } = await anon.rpc('team_view', { p_team_code: code })
  if (error) throw new Error(error.message)
  return data as View
}

beforeEach(async () => {
  await resetDb(service)
})

describe('team_view', () => {
  it('rejects an unknown team code', async () => {
    const result = await view('NOPE99')
    expect(result).toMatchObject({ ok: false, error: 'invalid_team_code' })
  })

  it('normalizes the submitted team code', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    expect((await view(' alpha-1 ')).team_name).toBe('Team 1')
  })

  it('returns one card per level with only the first unlocked once live', async () => {
    await seedStations(service, 4)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')

    const result = await view('ALPHA1')
    expect(result.total).toBe(4)
    expect(result.cards.map(c => c.level)).toEqual([1, 2, 3, 4])
    expect(result.cards.map(c => c.unlocked)).toEqual([true, false, false, false])
  })

  it('hides clue text for locked levels', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')

    const result = await view('ALPHA1')
    expect(result.cards[0].clue).toBe('Clue leading to station 1')
    expect(result.cards[1].clue).toBeNull()
    expect(JSON.stringify(result)).not.toContain('station 2')
  })

  it('locks every card before the game goes live', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    expect((await view('ALPHA1')).cards.every(c => !c.unlocked)).toBe(true)
  })

  it('reports the level being hunted with how many teams have cleared it', async () => {
    await seedStations(service, 3)
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 3', 'GAMMA3')
    await setGameStatus(service, 'live')

    expect((await view('ALPHA1')).race).toEqual({ level: 1, found: 0, teams: 3 })
  })

  it('counts teams already through the level being hunted', async () => {
    await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 3', 'GAMMA3')
    await setGameStatus(service, 'live')
    await service.from('teams').update({ current_position: 2 }).eq('id', a.id)
    await service.from('teams').update({ current_position: 1 }).eq('id', b.id)

    // B is hunting level 2; only A is through it
    expect((await view('BETA22')).race).toEqual({ level: 2, found: 1, teams: 3 })
  })

  it('marks opened cards and reports no race once finished', async () => {
    await seedStations(service, 3)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')
    await service.from('card_opens').insert({ team_id: a.id, level: 1 })
    await service.from('teams').update({ status: 'finished', finished_at: new Date().toISOString() }).eq('id', a.id)

    const result = await view('ALPHA1')
    expect(result.cards[0].opened).toBe(true)
    expect(result.race).toBeNull()
    expect(result.status).toBe('finished')
    expect(result.place).toBe(1)
  })
})
