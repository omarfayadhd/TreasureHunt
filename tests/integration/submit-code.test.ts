import { beforeEach, describe, expect, it } from 'vitest'
import {
  anonClient, clearCooldown, createTeam, resetDb, seedStations, serviceClient, setGameStatus,
} from './helpers'

const service = serviceClient()
const anon = anonClient()

type Submit = {
  ok: boolean
  error?: string
  correct?: boolean
  reason?: string
  retry_after_seconds?: number
  view?: {
    cleared: number
    status: string
    race: { level: number; slots: number; taken: number } | null
    cards: { level: number; unlocked: boolean; opened: boolean; clue: string | null }[]
  }
}

async function submit(teamCode: string, code: string): Promise<Submit> {
  const { data, error } = await anon.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw new Error(error.message)
  return data as Submit
}

async function teamRow(id: string) {
  const { data } = await service.from('teams').select('*').eq('id', id).single()
  return data as { current_position: number; status: string; out_at_level: number | null }
}

/** Three teams, three levels, game live, initial_team_count snapshotted. */
async function threeTeamGame() {
  const stations = await seedStations(service, 3)
  const a = await createTeam(service, 'Team 1', 'ALPHA1')
  const b = await createTeam(service, 'Team 2', 'BETA22')
  const c = await createTeam(service, 'Team 3', 'GAMMA3')
  await setGameStatus(service, 'live')
  await service.from('game').update({ initial_team_count: 3 }).eq('id', 1)
  return { stations, a, b, c }
}

beforeEach(async () => {
  await resetDb(service)
})

describe('submit_code', () => {
  it('accepts the level 1 code and unlocks the next card', async () => {
    const { a } = await threeTeamGame()
    const result = await submit('ALPHA1', 'code1')
    expect(result).toMatchObject({ ok: true, correct: true })
    expect(result.view!.cleared).toBe(1)
    expect(result.view!.cards.map(c => c.unlocked)).toEqual([true, true, false])
    expect((await teamRow(a.id)).current_position).toBe(1)
  })

  it('rejects a wrong code without advancing', async () => {
    const { a } = await threeTeamGame()
    const result = await submit('ALPHA1', 'WRONG9')
    expect(result).toMatchObject({ ok: true, correct: false, reason: 'wrong' })
    expect((await teamRow(a.id)).current_position).toBe(0)
  })

  it('nudges a team that re-enters a code it already used', async () => {
    const { a } = await threeTeamGame()
    await submit('ALPHA1', 'CODE1')
    await clearCooldown(service, a.id)
    expect(await submit('ALPHA1', 'CODE1')).toMatchObject({ correct: false, reason: 'already_used' })
  })

  it('lets every team through the opening race', async () => {
    await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) {
      expect(await submit(code, 'CODE1')).toMatchObject({ correct: true })
    }
    const { data } = await service.from('teams').select('status')
    expect((data as { status: string }[]).every(t => t.status === 'playing')).toBe(true)
  })

  it('eliminates the slowest team when a later race fills', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) await submit(code, 'CODE1')
    for (const id of [a.id, b.id, c.id]) await clearCooldown(service, id)

    // Level 2 has 3 alive - 1 = 2 slots
    await submit('ALPHA1', 'CODE2')
    expect((await teamRow(c.id)).status).toBe('playing')
    await submit('BETA22', 'CODE2')

    expect((await teamRow(c.id))).toMatchObject({ status: 'eliminated', out_at_level: 2 })
  })

  it('refuses a submit from an eliminated team', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) await submit(code, 'CODE1')
    for (const id of [a.id, b.id, c.id]) await clearCooldown(service, id)
    await submit('ALPHA1', 'CODE2')
    await submit('BETA22', 'CODE2')

    expect(await submit('GAMMA3', 'CODE2')).toMatchObject({ ok: false, error: 'not_playing' })
  })

  it('crowns the last team standing without needing the final card', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) await submit(code, 'CODE1')
    for (const id of [a.id, b.id, c.id]) await clearCooldown(service, id)
    await submit('ALPHA1', 'CODE2')
    await submit('BETA22', 'CODE2')  // C out
    for (const id of [a.id, b.id]) await clearCooldown(service, id)

    // Level 3 with 2 alive has 1 slot: A wins, B is swept
    await submit('ALPHA1', 'CODE3')
    expect((await teamRow(a.id)).status).toBe('winner')
    expect((await teamRow(b.id))).toMatchObject({ status: 'eliminated', out_at_level: 3 })
  })

  it('lets a solo team play the whole ladder', async () => {
    await seedStations(service, 3)
    const solo = await createTeam(service, 'Solo', 'SOLO12')
    await setGameStatus(service, 'live')
    await service.from('game').update({ initial_team_count: 1 }).eq('id', 1)

    for (const code of ['CODE1', 'CODE2', 'CODE3']) {
      expect(await submit('SOLO12', code)).toMatchObject({ correct: true })
      await clearCooldown(service, solo.id)
    }
    expect((await teamRow(solo.id))).toMatchObject({ status: 'winner', current_position: 3 })
  })

  it('places later finishers behind the winner when clues run short', async () => {
    const stations = await seedStations(service, 1)
    expect(stations).toHaveLength(1)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    const c = await createTeam(service, 'Team 3', 'GAMMA3')
    await setGameStatus(service, 'live')
    await service.from('game').update({ initial_team_count: 3 }).eq('id', 1)

    // One level, 3 alive: the opening race fits everyone, so all three finish.
    // Regression guard: counting only 'playing' teams as alive would shrink the
    // pool as each team finishes and eliminate the last one instead.
    await submit('ALPHA1', 'CODE1')
    await submit('BETA22', 'CODE1')
    await submit('GAMMA3', 'CODE1')

    expect((await teamRow(a.id)).status).toBe('winner')
    expect((await teamRow(b.id)).status).toBe('finished')
    expect((await teamRow(c.id)).status).toBe('finished')
  })

  it('rejects submits while the game is paused', async () => {
    await threeTeamGame()
    await setGameStatus(service, 'paused')
    expect(await submit('ALPHA1', 'CODE1')).toMatchObject({ ok: false, error: 'game_not_live' })
  })

  it('enforces the five second cooldown', async () => {
    await threeTeamGame()
    await submit('ALPHA1', 'WRONG1')
    const second = await submit('ALPHA1', 'WRONG2')
    expect(second).toMatchObject({ ok: false, error: 'cooldown' })
    expect(second.retry_after_seconds as number).toBeGreaterThan(0)
  })

  it('serializes two teams racing for the last slot', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) await submit(code, 'CODE1')
    for (const id of [a.id, b.id, c.id]) await clearCooldown(service, id)
    await submit('ALPHA1', 'CODE2')
    for (const id of [b.id, c.id]) await clearCooldown(service, id)

    // One slot left, two teams submit at once: exactly one gets it
    const [first, second] = await Promise.all([submit('BETA22', 'CODE2'), submit('GAMMA3', 'CODE2')])
    const outcomes = [first, second].map(r => (r.ok && r.correct ? 'through' : r.reason ?? r.error))
    expect(outcomes.filter(o => o === 'through')).toHaveLength(1)
    expect(outcomes.filter(o => o === 'too_late' || o === 'not_playing')).toHaveLength(1)
  })
})
