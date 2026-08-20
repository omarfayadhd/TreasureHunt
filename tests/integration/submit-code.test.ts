import { beforeEach, describe, expect, it } from 'vitest'
import {
  anonClient, clearCooldown, createTeam, resetDb, seedStations, serviceClient, setGameStatus,
  setRoute, type SeededStation,
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
    cards: {
      level: number
      unlocked: boolean
      opened: boolean
      clue: string | null
      location: string | null
    }[]
  }
}

// Every code belongs to exactly one team, so a team's ladder is its own column.
const CODES: Record<string, string[]> = {
  ALPHA1: ['AAA111', 'AAA222', 'AAA333'],
  BETA22: ['BBB111', 'BBB222', 'BBB333'],
  GAMMA3: ['CCC111', 'CCC222', 'CCC333'],
}

async function submit(teamCode: string, code: string): Promise<Submit> {
  const { data, error } = await anon.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw new Error(error.message)
  return data as Submit
}

async function teamRow(id: string) {
  const { data } = await service.from('teams').select('*').eq('id', id).single()
  return data as {
    current_position: number
    status: string
    out_at_level: number | null
    finished_at: string | null
  }
}

/**
 * Staggered rotation: team `index` (0-based) starts at location `index` and
 * wraps, so no two teams share a location at the same level.
 */
function rotation(stations: SeededStation[], index: number, codes: string[]) {
  return stations.map((_, level) => ({
    level: level + 1,
    stationId: stations[(level + index) % stations.length].id,
    code: codes[level],
  }))
}

/** Three teams, three levels each on staggered routes, game live. */
async function threeTeamGame() {
  const stations = await seedStations(service, 3)
  const a = await createTeam(service, 'Team 1', 'ALPHA1')
  const b = await createTeam(service, 'Team 2', 'BETA22')
  const c = await createTeam(service, 'Team 3', 'GAMMA3')
  await setRoute(service, a.id, rotation(stations, 0, CODES.ALPHA1))
  await setRoute(service, b.id, rotation(stations, 1, CODES.BETA22))
  await setRoute(service, c.id, rotation(stations, 2, CODES.GAMMA3))
  await setGameStatus(service, 'live')
  await service.from('game').update({ initial_team_count: 3 }).eq('id', 1)
  return { stations, a, b, c }
}

/** Two teams, two levels each: A's level 1 is AAA111, B's is BBB111. */
async function twoTeamGame() {
  const stations = await seedStations(service, 2)
  const a = await createTeam(service, 'Team 1', 'ALPHA1')
  const b = await createTeam(service, 'Team 2', 'BETA22')
  await setRoute(service, a.id, rotation(stations, 0, CODES.ALPHA1))
  await setRoute(service, b.id, rotation(stations, 1, CODES.BETA22))
  await setGameStatus(service, 'live')
  await service.from('game').update({ initial_team_count: 2 }).eq('id', 1)
  return { stations, a, b }
}

beforeEach(async () => {
  await resetDb(service)
})

describe('submit_code', () => {
  it('accepts the level 1 code and unlocks the next card', async () => {
    const { a } = await threeTeamGame()
    const result = await submit('ALPHA1', 'aaa-111')
    expect(result).toMatchObject({ ok: true, correct: true })
    expect(result.view!.cleared).toBe(1)
    expect(result.view!.cards.map(c => c.unlocked)).toEqual([true, true, false])
    expect((await teamRow(a.id)).current_position).toBe(1)
  })

  it("rejects another team's code without advancing anyone", async () => {
    const { a, b } = await twoTeamGame()
    const result = await submit('ALPHA1', 'BBB111')
    expect(result).toMatchObject({ ok: true, correct: false, reason: 'not_your_code' })
    expect((await teamRow(a.id)).current_position).toBe(0)
    expect((await teamRow(b.id)).current_position).toBe(0)
    const { data } = await service.from('attempts').select('result').eq('team_id', a.id)
    expect(data).toEqual([{ result: 'not_your_code' }])
  })

  it("accepts each team's own code for the same level", async () => {
    const { a, b } = await twoTeamGame()
    expect(await submit('ALPHA1', 'AAA111')).toMatchObject({ correct: true })
    expect(await submit('BETA22', 'BBB111')).toMatchObject({ correct: true })
    expect((await teamRow(a.id)).current_position).toBe(1)
    expect((await teamRow(b.id)).current_position).toBe(1)
  })

  it("refuses a code from a later level of this team's own route", async () => {
    const { a } = await threeTeamGame()
    expect(await submit('ALPHA1', 'AAA333')).toMatchObject({ correct: false, reason: 'wrong' })
    expect((await teamRow(a.id)).current_position).toBe(0)
  })

  it('rejects a wrong code without advancing', async () => {
    const { a } = await threeTeamGame()
    const result = await submit('ALPHA1', 'WRONG9')
    expect(result).toMatchObject({ ok: true, correct: false, reason: 'wrong' })
    expect((await teamRow(a.id)).current_position).toBe(0)
  })

  it('nudges a team that re-enters a code it already used', async () => {
    const { a } = await threeTeamGame()
    await submit('ALPHA1', 'AAA111')
    await clearCooldown(service, a.id)
    expect(await submit('ALPHA1', 'AAA111')).toMatchObject({ correct: false, reason: 'already_used' })
  })

  it('lets every team through the opening race', async () => {
    await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) {
      expect(await submit(code, CODES[code][0])).toMatchObject({ correct: true })
    }
    const { data } = await service.from('teams').select('status')
    expect((data as { status: string }[]).every(t => t.status === 'playing')).toBe(true)
  })

  it('lets every team clear its own level 1', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of ['ALPHA1', 'BETA22', 'GAMMA3']) {
      expect(await submit(code, CODES[code][0])).toMatchObject({ ok: true, correct: true })
    }
    for (const id of [a.id, b.id, c.id]) {
      expect((await teamRow(id))).toMatchObject({ current_position: 1, status: 'playing' })
    }
  })

  it('lets two teams clear the same location at different levels', async () => {
    // Rotation: A visits Station 2 at level 2, B visits Station 2 at level 1.
    const { a, b } = await threeTeamGame()
    expect(await submit('BETA22', 'BBB111')).toMatchObject({ correct: true })
    expect(await submit('ALPHA1', 'AAA111')).toMatchObject({ correct: true })
    await clearCooldown(service, a.id)
    expect(await submit('ALPHA1', 'AAA222')).toMatchObject({ correct: true })
    expect((await teamRow(a.id)).current_position).toBe(2)
    expect((await teamRow(b.id)).current_position).toBe(1)
  })

  // Clearing every leg is not winning: the treasure is a level of its own, and
  // only submitting its code ends anything. See treasure.test.ts.
  it('eliminates nobody and crowns nobody for clearing every staggered leg', async () => {
    const { a, b, c } = await threeTeamGame()
    for (const code of CODES.ALPHA1) {
      await submit('ALPHA1', code)
      await clearCooldown(service, a.id)
    }
    expect((await teamRow(a.id))).toMatchObject({ status: 'playing', current_position: 3 })
    for (const id of [b.id, c.id]) {
      expect((await teamRow(id))).toMatchObject({ status: 'playing', current_position: 0, out_at_level: null })
    }
    const { data } = await service.from('teams').select('status').neq('status', 'playing')
    expect(data).toEqual([])
  })


  it('lets two teams clear their own level 2 simultaneously', async () => {
    const { a, b } = await threeTeamGame()
    await submit('ALPHA1', 'AAA111')
    await submit('BETA22', 'BBB111')
    for (const id of [a.id, b.id]) await clearCooldown(service, id)

    const [first, second] = await Promise.all([submit('ALPHA1', 'AAA222'), submit('BETA22', 'BBB222')])
    expect(first).toMatchObject({ ok: true, correct: true })
    expect(second).toMatchObject({ ok: true, correct: true })
    for (const id of [a.id, b.id]) expect((await teamRow(id)).current_position).toBe(2)
  })

  it('never lets the same team double-advance on a concurrent double-submit', async () => {
    const { a } = await threeTeamGame()

    const [first, second] = await Promise.all([submit('ALPHA1', 'AAA111'), submit('ALPHA1', 'AAA111')])
    const outcomes = [first, second].map(r => (r.ok && r.correct ? 'correct' : r.ok === false ? r.error : r.reason))
    expect(outcomes.filter(o => o === 'correct')).toHaveLength(1)
    expect(outcomes.filter(o => o === 'cooldown')).toHaveLength(1)

    expect((await teamRow(a.id)).current_position).toBe(1)
    const { data } = await service.from('attempts').select('result').eq('team_id', a.id).eq('result', 'correct')
    expect(data).toHaveLength(1)
  })

  it('rejects submits while the game is paused', async () => {
    await threeTeamGame()
    await setGameStatus(service, 'paused')
    expect(await submit('ALPHA1', 'AAA111')).toMatchObject({ ok: false, error: 'game_not_live' })
  })

  it('enforces the five second cooldown', async () => {
    await threeTeamGame()
    await submit('ALPHA1', 'WRONG1')
    const second = await submit('ALPHA1', 'WRONG2')
    expect(second).toMatchObject({ ok: false, error: 'cooldown' })
    expect(second.retry_after_seconds as number).toBeGreaterThan(0)
  })
})
