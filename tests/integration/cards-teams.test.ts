import { beforeEach, describe, expect, it } from 'vitest'
import {
  adminClient, anonClient, createTeam, resetDb, seedStations, serviceClient, setGameStatus, setRoute,
  type SeededStation,
} from './helpers'

const service = serviceClient()
const anon = anonClient()

async function openCard(teamCode: string, level: number) {
  const { data, error } = await anon.rpc('open_card', { p_team_code: teamCode, p_level: level })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; error?: string; clue?: string; view?: { cards: { opened: boolean }[] } }
}

/** Straight route: level L is the Lth location, with this team's own codes. */
function straightRoute(stations: SeededStation[], prefix: string) {
  return stations.map((station, index) => ({
    level: index + 1,
    stationId: station.id,
    code: `${prefix}${index + 1}${index + 1}${index + 1}`,
  }))
}

beforeEach(async () => {
  await resetDb(service)
})

describe('open_card', () => {
  it('reveals an unlocked clue and records the open', async () => {
    const stations = await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, team.id, straightRoute(stations, 'AAA'))
    await setGameStatus(service, 'live')

    const result = await openCard('ALPHA1', 1)
    expect(result.ok).toBe(true)
    expect(result.clue).toBe('Clue leading to station 1')
    expect(result.view!.cards[0].opened).toBe(true)

    const { data } = await service.from('card_opens').select('*').eq('team_id', team.id)
    expect(data).toHaveLength(1)
  })

  it('is a no-op on a repeat scratch', async () => {
    const stations = await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, team.id, straightRoute(stations, 'AAA'))
    await setGameStatus(service, 'live')

    await openCard('ALPHA1', 1)
    expect((await openCard('ALPHA1', 1)).ok).toBe(true)
    const { data } = await service.from('card_opens').select('*').eq('team_id', team.id)
    expect(data).toHaveLength(1)
  })

  it('refuses a locked level and leaks no clue', async () => {
    const stations = await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, team.id, straightRoute(stations, 'AAA'))
    await setGameStatus(service, 'live')

    const result = await openCard('ALPHA1', 3)
    expect(result).toMatchObject({ ok: false, error: 'locked' })
    expect(JSON.stringify(result)).not.toContain('station 3')
  })

  it('refuses before the game is live', async () => {
    const stations = await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, team.id, straightRoute(stations, 'AAA'))
    expect(await openCard('ALPHA1', 1)).toMatchObject({ ok: false, error: 'game_not_live' })
  })

  // Revision 2 can never produce 'eliminated'. A team that has finished is the
  // reachable analogue: it stops submitting but should still be able to re-read
  // the clues it earned.
  it('lets a finished team re-open a card it already had', async () => {
    const stations = await seedStations(service, 3)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setRoute(service, team.id, straightRoute(stations, 'AAA'))
    await setGameStatus(service, 'live')
    await service.from('teams')
      .update({ status: 'finished', current_position: 3, finished_at: new Date().toISOString() })
      .eq('id', team.id)

    expect((await openCard('ALPHA1', 1)).ok).toBe(true)
    expect((await openCard('ALPHA1', 3)).ok).toBe(true)
  })

  it("serves each team the clue from its own route", async () => {
    const stations = await seedStations(service, 2)
    const a = await createTeam(service, 'Team 1', 'ALPHA1')
    const b = await createTeam(service, 'Team 2', 'BETA22')
    await setRoute(service, a.id, [{ level: 1, stationId: stations[0].id, code: 'AAA111' }])
    await setRoute(service, b.id, [{ level: 1, stationId: stations[1].id, code: 'BBB111' }])
    await setGameStatus(service, 'live')

    expect((await openCard('ALPHA1', 1)).clue).toBe('Clue leading to station 1')
    expect((await openCard('BETA22', 1)).clue).toBe('Clue leading to station 2')
  })
})

describe('generate_teams', () => {
  it('creates teams up to the requested count with valid codes', async () => {
    const admin = await adminClient()
    const { data, error } = await admin.rpc('generate_teams', { p_count: 3 })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true, created: 3, total: 3 })

    const { data: teams } = await service.from('teams').select('name, team_code').order('name')
    expect((teams as { name: string }[]).map(t => t.name)).toEqual(['Team 1', 'Team 2', 'Team 3'])
    for (const t of teams as { team_code: string }[]) expect(t.team_code).toMatch(/^[A-Z0-9]{3,12}$/)
  })

  it('tops up rather than duplicating existing teams', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    const { data } = await admin.rpc('generate_teams', { p_count: 3 })
    expect(data).toMatchObject({ ok: true, created: 2, total: 3 })
  })

  it('creates nothing when the count is already met', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')
    expect(await admin.rpc('generate_teams', { p_count: 2 }).then(r => r.data))
      .toMatchObject({ ok: true, created: 0, total: 2 })
  })

  it('refuses while the game is live', async () => {
    const admin = await adminClient()
    await setGameStatus(service, 'live')
    expect(await admin.rpc('generate_teams', { p_count: 3 }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'game_live' })
  })

  it('refuses while the game is paused', async () => {
    const admin = await adminClient()
    await setGameStatus(service, 'paused')
    expect(await admin.rpc('generate_teams', { p_count: 3 }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'game_live' })
  })

  it('skips names already taken instead of colliding on teams_name_key', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 3', 'GAMMA3')

    const { data, error } = await admin.rpc('generate_teams', { p_count: 3 })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true, created: 1, total: 3 })

    const { data: teams } = await service.from('teams').select('name').order('name')
    expect((teams as { name: string }[]).map(t => t.name)).toEqual(['Team 1', 'Team 2', 'Team 3'])
  })

  it('keeps skipping past a whole run of gaps', async () => {
    const admin = await adminClient()
    await createTeam(service, 'Team 2', 'BETA22')
    await createTeam(service, 'Team 4', 'DELTA4')

    expect(await admin.rpc('generate_teams', { p_count: 5 }).then(r => r.data))
      .toMatchObject({ ok: true, created: 3, total: 5 })
    const { data: teams } = await service.from('teams').select('name').order('name')
    expect((teams as { name: string }[]).map(t => t.name).sort())
      .toEqual(['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5'])
  })

  it('creates codes that are unique across a full generate', async () => {
    const admin = await adminClient()
    await admin.rpc('generate_teams', { p_count: 20 })
    const { data: teams } = await service.from('teams').select('team_code')
    const codes = (teams as { team_code: string }[]).map(t => t.team_code)
    expect(new Set(codes).size).toBe(20)
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })

  it('rejects a nonsense count', async () => {
    const admin = await adminClient()
    expect(await admin.rpc('generate_teams', { p_count: 0 }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'bad_count' })
  })

  it('is not callable anonymously', async () => {
    const { error } = await anon.rpc('generate_teams', { p_count: 3 })
    expect(error).not.toBeNull()
  })
})
