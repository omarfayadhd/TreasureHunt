import { beforeEach, describe, expect, it } from 'vitest'
import {
  adminClient, anonClient, clearCooldown, createTeam, resetDb, seedStations, serviceClient,
  setGameStatus, setRoute, setTreasure,
} from './helpers'

const service = serviceClient()
const anon = anonClient()

type Submit = { ok: boolean; correct?: boolean; reason?: string; error?: string; view?: View }
type View = {
  status: string
  cleared: number
  total: number
  demo: boolean
  demo_won: boolean
  race: { level: number; found: number; teams: number } | null
}

async function submit(teamCode: string, code: string): Promise<Submit> {
  const { data, error } = await anon.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw new Error(error.message)
  return data as Submit
}

async function view(code: string): Promise<View> {
  const { data } = await anon.rpc('team_view', { p_team_code: code })
  return data as View
}

async function teamRow(id: string) {
  const { data } = await service.from('teams').select('*').eq('id', id).single()
  return data as {
    is_demo: boolean
    status: string
    current_position: number
    finished_at: string | null
    demo_won_at: string | null
  }
}

/** A real team and the demo team, one staggered leg each, plus the treasure. */
async function game() {
  const stations = await seedStations(service, 3)
  const real = await createTeam(service, 'Owls', 'OWLS11')
  const demo = await createTeam(service, 'Demo', 'DEMO11')
  await setRoute(service, real.id, [{ level: 1, stationId: stations[0].id, code: 'OWL111' }])
  await setRoute(service, demo.id, [{ level: 1, stationId: stations[1].id, code: 'DEM111' }])
  await setTreasure(service, stations[2].id, 'TREAS9')
  const admin = await adminClient()
  await admin.rpc('set_demo_team', { p_team_id: demo.id, p_is_demo: true })
  await setGameStatus(service, 'live')
  return { stations, real, demo, admin }
}

beforeEach(async () => {
  await resetDb(service)
})

describe('the demo team', () => {
  it('is flagged, and only one team can be the demo', async () => {
    const { real, demo, admin } = await game()
    expect((await teamRow(demo.id)).is_demo).toBe(true)
    expect((await teamRow(real.id)).is_demo).toBe(false)

    // Handing the flag to another team takes it off the first.
    expect(await admin.rpc('set_demo_team', { p_team_id: real.id, p_is_demo: true }).then(r => r.data))
      .toMatchObject({ ok: true })
    expect((await teamRow(real.id)).is_demo).toBe(true)
    expect((await teamRow(demo.id)).is_demo).toBe(false)
  })

  it('celebrates a treasure submit without taking the treasure', async () => {
    const { real, demo } = await game()
    expect(await submit('DEMO11', 'DEM111')).toMatchObject({ correct: true })
    await clearCooldown(service, demo.id)

    const won = await submit('DEMO11', 'TREAS9')
    expect(won).toMatchObject({ ok: true, correct: true })
    expect(won.view).toMatchObject({ demo: true, demo_won: true, status: 'playing' })

    // The treasure is still there for a real team.
    const row = await teamRow(demo.id)
    expect(row).toMatchObject({ status: 'playing', finished_at: null })
    expect(row.demo_won_at).not.toBeNull()
    expect((await service.from('teams').select('id').eq('status', 'winner')).data).toEqual([])

    expect(await submit('OWLS11', 'OWL111')).toMatchObject({ correct: true })
    await clearCooldown(service, real.id)
    expect(await submit('OWLS11', 'TREAS9')).toMatchObject({ correct: true })
    expect((await teamRow(real.id)).status).toBe('winner')
  })

  it('can be replayed as often as you like, even after a real team has won', async () => {
    const { real, demo, admin } = await game()
    await submit('OWLS11', 'OWL111')
    await clearCooldown(service, real.id)
    await submit('OWLS11', 'TREAS9')
    expect((await teamRow(real.id)).status).toBe('winner')

    await submit('DEMO11', 'DEM111')
    await clearCooldown(service, demo.id)
    // The demo still gets its celebration: it is a demonstration, not a race.
    expect(await submit('DEMO11', 'TREAS9')).toMatchObject({ correct: true })
    expect((await view('DEMO11')).demo_won).toBe(true)

    expect(await admin.rpc('reset_demo_team').then(r => r.data)).toMatchObject({ ok: true })
    const afterReset = await teamRow(demo.id)
    expect(afterReset).toMatchObject({ current_position: 0, demo_won_at: null, status: 'playing' })
    const { data: opens } = await service.from('card_opens').select('*').eq('team_id', demo.id)
    expect(opens).toEqual([])

    // And again, from the top.
    expect(await submit('DEMO11', 'DEM111')).toMatchObject({ correct: true })
  })

  it('is left out of the race counts real teams see', async () => {
    const { demo } = await game()
    await submit('DEMO11', 'DEM111')
    await clearCooldown(service, demo.id)

    // One real team in the hunt, and the demo's progress does not show up as a rival.
    expect((await view('OWLS11')).race).toEqual({ level: 1, found: 0, teams: 1 })
  })

  it('is left out of the team-count snapshot at kickoff', async () => {
    const { admin } = await game()
    await setGameStatus(service, 'setup')
    expect(await admin.rpc('start_game').then(r => r.data)).toMatchObject({ ok: true, teams: 1 })
    const { data } = await service.from('game').select('initial_team_count').single()
    expect(data).toMatchObject({ initial_team_count: 1 })
  })

  it('still has to solve its own legs — the demo shows the real thing', async () => {
    const { demo } = await game()
    expect(await submit('DEMO11', 'TREAS9')).toMatchObject({ correct: false, reason: 'wrong' })
    await clearCooldown(service, demo.id)
    expect(await submit('DEMO11', 'OWL111')).toMatchObject({ correct: false, reason: 'not_your_code' })
  })

  it('lets a real team win normally while the demo sits at the treasure', async () => {
    const { real, demo } = await game()
    await submit('DEMO11', 'DEM111')
    await clearCooldown(service, demo.id)
    await submit('DEMO11', 'TREAS9')

    await submit('OWLS11', 'OWL111')
    await clearCooldown(service, real.id)
    expect(await submit('OWLS11', 'TREAS9')).toMatchObject({ correct: true })
    expect((await view('OWLS11')).status).toBe('winner')
    expect((await view('DEMO11')).status).toBe('playing')
  })

  it('refuses demo administration to anonymous callers', async () => {
    const { demo } = await game()
    for (const [fn, args] of [
      ['set_demo_team', { p_team_id: demo.id, p_is_demo: true }],
      ['reset_demo_team', {}],
    ] as const) {
      const { error } = await anon.rpc(fn, args)
      expect(error?.code, fn).toBe('42501')
    }
  })
})
