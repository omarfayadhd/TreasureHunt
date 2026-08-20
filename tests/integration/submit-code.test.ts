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
    race: { level: number; found: number; teams: number } | null
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

  it('lets every team clear the same level', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) {
      expect(await submit(code, 'CODE1')).toMatchObject({ ok: true, correct: true })
    }
    for (const id of [a.id, b.id, c.id]) {
      expect((await teamRow(id))).toMatchObject({ current_position: 1, status: 'playing' })
    }
  })

  it('never eliminates anyone, however far apart the teams are', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['CODE1', 'CODE2', 'CODE3']) {
      await submit('ALPHA1', code)
      await clearCooldown(service, a.id)
    }
    // A has claimed the treasure; B and C have not moved at all
    expect((await teamRow(a.id)).status).toBe('winner')
    for (const id of [b.id, c.id]) {
      expect((await teamRow(id))).toMatchObject({ status: 'playing', current_position: 0, out_at_level: null })
    }
    const { data } = await service.from('teams').select('status').eq('status', 'eliminated')
    expect(data).toEqual([])
  })

  it('crowns the first finisher and places later ones behind it', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const team of [['ALPHA1', a.id], ['BETA22', b.id]] as const) {
      for (const code of ['CODE1', 'CODE2', 'CODE3']) {
        await submit(team[0], code)
        await clearCooldown(service, team[1])
      }
    }
    expect((await teamRow(a.id)).status).toBe('winner')
    expect((await teamRow(b.id)).status).toBe('finished')
    expect((await teamRow(c.id)).status).toBe('playing')

    const view = (await submit('GAMMA3', 'NOPE99')).view!
    expect(view.status).toBe('playing')
  })

  it('refuses further submits from a finished team', async () => {
    const { a } = await threeTeamGame()
    for (const code of ['CODE1', 'CODE2', 'CODE3']) {
      await submit('ALPHA1', code)
      await clearCooldown(service, a.id)
    }
    expect(await submit('ALPHA1', 'CODE1')).toMatchObject({ ok: false, error: 'not_playing' })
  })

  it('lets two teams clear the same level simultaneously', async () => {
    const { a, b } = await threeTeamGame()
    await submit('ALPHA1', 'CODE1')
    await submit('BETA22', 'CODE1')
    for (const id of [a.id, b.id]) await clearCooldown(service, id)

    const [first, second] = await Promise.all([submit('ALPHA1', 'CODE2'), submit('BETA22', 'CODE2')])
    expect(first).toMatchObject({ ok: true, correct: true })
    expect(second).toMatchObject({ ok: true, correct: true })
    for (const id of [a.id, b.id]) expect((await teamRow(id)).current_position).toBe(2)
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
})
