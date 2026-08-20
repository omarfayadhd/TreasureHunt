import { beforeEach, describe, expect, it } from 'vitest'
import {
  adminClient, anonClient, clearCooldown, createTeam, resetDb, seedStations, serviceClient,
  setGameStatus, setRoute, setTreasure, type SeededStation,
} from './helpers'

const service = serviceClient()
const anon = anonClient()

type Submit = {
  ok: boolean
  error?: string
  correct?: boolean
  reason?: string
  view?: { cleared: number; total: number; status: string }
}

async function submit(teamCode: string, code: string): Promise<Submit> {
  const { data, error } = await anon.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw new Error(error.message)
  return data as Submit
}

type View = {
  total: number
  cleared: number
  status: string
  cards: { level: number; unlocked: boolean; location: string | null; clue: string | null }[]
}

async function view(code: string): Promise<View> {
  const { data } = await anon.rpc('team_view', { p_team_code: code })
  return data as View
}

async function teamRow(id: string) {
  const { data } = await service.from('teams').select('*').eq('id', id).single()
  return data as { current_position: number; status: string; finished_at: string | null }
}

/**
 * Two teams, two staggered legs each, then the one shared treasure everybody
 * converges on. Owls: Station 1 then Station 2. Mongooses: Station 2 then
 * Station 1. Treasure: Station 3, code TREAS9 for both teams.
 */
async function twoTeamGame(stations: SeededStation[]) {
  const owls = await createTeam(service, 'Owls', 'OWLS11')
  const mong = await createTeam(service, 'Mongooses', 'MONG22')
  await setRoute(service, owls.id, [
    { level: 1, stationId: stations[0].id, code: 'OWL111' },
    { level: 2, stationId: stations[1].id, code: 'OWL222' },
  ])
  await setRoute(service, mong.id, [
    { level: 1, stationId: stations[1].id, code: 'MON111' },
    { level: 2, stationId: stations[0].id, code: 'MON222' },
  ])
  await setTreasure(service, stations[2].id, 'TREAS9')
  await setGameStatus(service, 'live')
  await service.from('game').update({ initial_team_count: 2 }).eq('id', 1)
  return { owls, mong }
}

/** Walks a team through its staggered legs, leaving it one submit from the treasure. */
async function walkToTreasure(teamCode: string, teamId: string, codes: string[]) {
  for (const code of codes) {
    expect(await submit(teamCode, code), `${teamCode} ${code}`).toMatchObject({ correct: true })
    await clearCooldown(service, teamId)
  }
}

beforeEach(async () => {
  await resetDb(service)
})

describe('the shared treasure', () => {
  it('adds one final card, the same place for every team', async () => {
    const stations = await seedStations(service, 3)
    await twoTeamGame(stations)

    for (const code of ['OWLS11', 'MONG22']) {
      const teamView = await view(code)
      expect(teamView.total, code).toBe(3)
      expect(teamView.cards.map(c => c.level), code).toEqual([1, 2, 3])
    }
    // The treasure card is locked until both legs are cleared, so it names nothing yet.
    expect((await view('OWLS11')).cards[2].location).toBeNull()
  })

  it('names the treasure on the final card once the legs are cleared', async () => {
    const stations = await seedStations(service, 3)
    const { owls } = await twoTeamGame(stations)
    await walkToTreasure('OWLS11', owls.id, ['OWL111', 'OWL222'])

    const card = (await view('OWLS11')).cards[2]
    expect(card).toMatchObject({ level: 3, unlocked: true, location: 'Station 3' })
    expect(card.clue).toBe('Clue leading to station 3')
  })

  it('refuses the treasure code while a leg is still unsolved', async () => {
    const stations = await seedStations(service, 3)
    const { owls } = await twoTeamGame(stations)

    expect(await submit('OWLS11', 'TREAS9')).toMatchObject({ correct: false, reason: 'wrong' })
    expect((await teamRow(owls.id)).current_position).toBe(0)
  })

  it('crowns the first team to submit the treasure code', async () => {
    const stations = await seedStations(service, 3)
    const { owls } = await twoTeamGame(stations)
    await walkToTreasure('OWLS11', owls.id, ['OWL111', 'OWL222'])

    expect(await submit('OWLS11', 'treas-9')).toMatchObject({ ok: true, correct: true })
    const row = await teamRow(owls.id)
    expect(row).toMatchObject({ status: 'winner', current_position: 3 })
    expect(row.finished_at).not.toBeNull()
  })

  it('accepts the same code from every team: one treasure, one code', async () => {
    const stations = await seedStations(service, 3)
    const { mong } = await twoTeamGame(stations)
    await walkToTreasure('MONG22', mong.id, ['MON111', 'MON222'])
    expect(await submit('MONG22', 'TREAS9')).toMatchObject({ correct: true })
    expect((await teamRow(mong.id)).status).toBe('winner')
  })

  it('tells a later team the treasure is gone, and leaves it short of the finish', async () => {
    const stations = await seedStations(service, 3)
    const { owls, mong } = await twoTeamGame(stations)
    await walkToTreasure('OWLS11', owls.id, ['OWL111', 'OWL222'])
    await submit('OWLS11', 'TREAS9')
    await walkToTreasure('MONG22', mong.id, ['MON111', 'MON222'])

    expect(await submit('MONG22', 'TREAS9'))
      .toMatchObject({ ok: true, correct: false, reason: 'treasure_claimed' })
    const row = await teamRow(mong.id)
    expect(row).toMatchObject({ status: 'playing', current_position: 2 })
    expect(row.finished_at).toBeNull()
    const { data } = await service.from('attempts')
      .select('result').eq('team_id', mong.id).eq('result', 'treasure_claimed')
    expect(data).toHaveLength(1)
  })

  it('leaves the losing team playing and the hunt live, with nothing said', async () => {
    const stations = await seedStations(service, 3)
    const { owls, mong } = await twoTeamGame(stations)
    await walkToTreasure('OWLS11', owls.id, ['OWL111', 'OWL222'])
    await submit('OWLS11', 'TREAS9')

    // Mongooses were mid-hunt when the treasure went. Their game carries on
    // exactly as before: still playing, still clearing their own legs.
    const { data: game } = await service.from('game').select('status').single()
    expect(game).toMatchObject({ status: 'live' })
    expect((await teamRow(mong.id)).status).toBe('playing')
    expect(await submit('MONG22', 'MON111')).toMatchObject({ correct: true })
    expect((await view('MONG22')).status).toBe('playing')
  })

  it('crowns exactly one winner when two teams submit the treasure code at once', async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await resetDb(service)
      const stations = await seedStations(service, 3)
      const { owls, mong } = await twoTeamGame(stations)
      await walkToTreasure('OWLS11', owls.id, ['OWL111', 'OWL222'])
      await walkToTreasure('MONG22', mong.id, ['MON111', 'MON222'])

      const results = await Promise.all([submit('OWLS11', 'TREAS9'), submit('MONG22', 'TREAS9')])
      const reasons = results.map(r => (r.correct ? 'winner' : r.reason))
      expect(reasons.filter(r => r === 'winner'), `run ${attempt}`).toHaveLength(1)
      expect(reasons.filter(r => r === 'treasure_claimed'), `run ${attempt}`).toHaveLength(1)

      const { data } = await service.from('teams').select('status').eq('status', 'winner')
      expect(data, `run ${attempt}`).toHaveLength(1)
    }
  })

  it('reports the treasure as the location a team on its final leg is hunting', async () => {
    const stations = await seedStations(service, 3)
    const { owls } = await twoTeamGame(stations)
    await walkToTreasure('OWLS11', owls.id, ['OWL111', 'OWL222'])

    const admin = await adminClient()
    const { data } = await admin.from('admin_monitor').select('name, current_location').eq('id', owls.id)
    expect(data).toMatchObject([{ name: 'Owls', current_location: 'Station 3' }])
  })
})

describe('kickoff with a treasure', () => {
  it('refuses to start with no treasure set', async () => {
    const stations = await seedStations(service, 3)
    const owls = await createTeam(service, 'Owls', 'OWLS11')
    await setRoute(service, owls.id, [{ level: 1, stationId: stations[0].id, code: 'OWL111' }])

    const admin = await adminClient()
    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: false, error: 'no_treasure' })
  })

  it('refuses to start when a route walks through the treasure', async () => {
    const stations = await seedStations(service, 3)
    const owls = await createTeam(service, 'Owls', 'OWLS11')
    await setRoute(service, owls.id, [{ level: 1, stationId: stations[0].id, code: 'OWL111' }])
    await setTreasure(service, stations[0].id, 'TREAS9')

    const admin = await adminClient()
    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: false, error: 'treasure_in_route' })
  })

  it('starts once the legs are staggered and the treasure is set aside', async () => {
    const stations = await seedStations(service, 3)
    await twoTeamGame(stations)
    await setGameStatus(service, 'setup')

    const admin = await adminClient()
    expect(await admin.rpc('start_game').then(r => r.data))
      .toMatchObject({ ok: true, status: 'live', teams: 2, levels: 3 })
  })
})

describe('treasure admin RPCs', () => {
  async function setup() {
    const stations = await seedStations(service, 3)
    const owls = await createTeam(service, 'Owls', 'OWLS11')
    await setRoute(service, owls.id, [{ level: 1, stationId: stations[0].id, code: 'OWL111' }])
    const admin = await adminClient()
    return { stations, owls, admin }
  }

  async function gameRow() {
    const { data } = await service.from('game').select('treasure_station_id, treasure_code').single()
    return data as { treasure_station_id: string | null; treasure_code: string | null }
  }

  it('sets the treasure location and mints its code', async () => {
    const { stations, admin } = await setup()
    const { data, error } = await admin.rpc('set_treasure', { p_station_id: stations[2].id })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true })
    expect((data as { code: string }).code).toMatch(/^[A-Z0-9]{3,12}$/)

    const game = await gameRow()
    expect(game.treasure_station_id).toBe(stations[2].id)
    expect(game.treasure_code).toBe((data as { code: string }).code)
  })

  it('keeps the printed code when the treasure moves to another location', async () => {
    const { stations, admin } = await setup()
    const first = await admin.rpc('set_treasure', { p_station_id: stations[2].id })
    const code = (first.data as { code: string }).code
    const second = await admin.rpc('set_treasure', { p_station_id: stations[1].id })
    expect(second.data).toMatchObject({ ok: true, code })
    expect(await gameRow()).toMatchObject({ treasure_station_id: stations[1].id, treasure_code: code })
  })

  it('refuses a location some team already walks through', async () => {
    const { stations, admin } = await setup()
    expect(await admin.rpc('set_treasure', { p_station_id: stations[0].id }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'location_used_by_team' })
    expect(await gameRow()).toMatchObject({ treasure_station_id: null })
  })

  it('reissues the treasure code on its own', async () => {
    const { stations, admin } = await setup()
    const first = await admin.rpc('set_treasure', { p_station_id: stations[2].id })
    const code = (first.data as { code: string }).code

    const { data } = await admin.rpc('set_treasure_code')
    expect(data).toMatchObject({ ok: true })
    const fresh = (data as { code: string }).code
    expect(fresh).not.toBe(code)
    expect(await gameRow()).toMatchObject({ treasure_station_id: stations[2].id, treasure_code: fresh })
  })

  it('refuses to reissue a code before a treasure location is picked', async () => {
    const { admin } = await setup()
    expect(await admin.rpc('set_treasure_code').then(r => r.data))
      .toMatchObject({ ok: false, error: 'no_treasure' })
  })

  it('clears the treasure again', async () => {
    const { stations, admin } = await setup()
    await admin.rpc('set_treasure', { p_station_id: stations[2].id })
    expect(await admin.rpc('clear_treasure').then(r => r.data)).toMatchObject({ ok: true })
    expect(await gameRow()).toMatchObject({ treasure_station_id: null, treasure_code: null })
  })

  it('refuses every treasure edit while the hunt is running', async () => {
    const { stations, admin } = await setup()
    await admin.rpc('set_treasure', { p_station_id: stations[2].id })
    await setGameStatus(service, 'live')

    for (const [fn, args] of [
      ['set_treasure', { p_station_id: stations[1].id }],
      ['set_treasure_code', {}],
      ['clear_treasure', {}],
    ] as const) {
      expect(await admin.rpc(fn, args).then(r => r.data), fn)
        .toMatchObject({ ok: false, error: 'game_running' })
    }
    expect(await gameRow()).toMatchObject({ treasure_station_id: stations[2].id })
  })

  it('is not callable anonymously', async () => {
    const { stations } = await setup()
    for (const [fn, args] of [
      ['set_treasure', { p_station_id: stations[2].id }],
      ['set_treasure_code', {}],
      ['clear_treasure', {}],
    ] as const) {
      const { error } = await anon.rpc(fn, args)
      expect(error?.code, fn).toBe('42501')
    }
  })

  it('refuses to route a team through the location the treasure sits on', async () => {
    const { stations, owls, admin } = await setup()
    await admin.rpc('set_treasure', { p_station_id: stations[2].id })
    expect(await admin.rpc('set_route_cell', {
      p_team_id: owls.id, p_level: 2, p_station_id: stations[2].id,
    }).then(r => r.data)).toMatchObject({ ok: false, error: 'is_the_treasure' })
  })
})
