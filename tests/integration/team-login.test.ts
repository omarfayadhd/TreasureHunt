import { anonClient, serviceClient, resetDb, seedStations, createTeam, setRoute, setGameStatus, type SeededStation } from './helpers'

const service = serviceClient()
const anon = anonClient()

describe('team_login', () => {
  let stations: SeededStation[]

  beforeEach(async () => {
    await resetDb(service)
    stations = await seedStations(service, 3) // CODE-1..3 + FINAL-99, in route order
  })

  async function login(teamCode: string) {
    const { data, error } = await anon.rpc('team_login', { p_team_code: teamCode })
    expect(error).toBeNull()
    return data
  }

  it('rejects unknown team codes', async () => {
    expect(await login('NOPE-00')).toEqual({ ok: false, error: 'invalid_team_code' })
  })

  it('returns team state without a clue while the game is in setup', async () => {
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    expect(await login('TEAM-11')).toEqual({
      ok: true,
      team_name: 'Mongooses',
      game_status: 'setup',
      position: 0,
      total: 4,
      clue: null,
      finished: false,
      rank: null,
    })
  })

  it('returns the next clue while live, ignoring team code case and spaces', async () => {
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    await setGameStatus(service, 'live')
    const result = await login('  team-11 ')
    expect(result).toMatchObject({
      ok: true,
      game_status: 'live',
      position: 0,
      total: 4,
      clue: 'Clue leading to station 1',
      finished: false,
    })
  })

  it('hides the clue while paused', async () => {
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    await setGameStatus(service, 'paused')
    expect(await login('TEAM-11')).toMatchObject({ ok: true, game_status: 'paused', clue: null })
  })

  it('reports finish state and rank', async () => {
    const first = await createTeam(service, 'First', 'TEAM-11')
    const second = await createTeam(service, 'Second', 'TEAM-22')
    await setRoute(service, first.id, stations.map(s => s.id))
    await setRoute(service, second.id, stations.map(s => s.id))
    await setGameStatus(service, 'live')
    const earlier = new Date(Date.now() - 60_000).toISOString()
    const later = new Date().toISOString()
    await service.from('teams').update({ current_position: 4, finished_at: earlier }).eq('id', first.id)
    await service.from('teams').update({ current_position: 4, finished_at: later }).eq('id', second.id)
    expect(await login('TEAM-22')).toMatchObject({ ok: true, finished: true, rank: 2, clue: null, position: 4 })
    expect(await login('TEAM-11')).toMatchObject({ ok: true, finished: true, rank: 1 })
  })
})
