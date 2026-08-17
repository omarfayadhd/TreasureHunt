import { anonClient, serviceClient, resetDb, seedStations, createTeam, setRoute, setGameStatus, clearCooldown, type SeededStation } from './helpers'

const service = serviceClient()
const anon = anonClient()

describe('submit_code', () => {
  let stations: SeededStation[]
  let teamId: string

  beforeEach(async () => {
    await resetDb(service)
    stations = await seedStations(service, 3) // route: CODE-1, CODE-2, CODE-3, FINAL-99
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    teamId = team.id
    await setRoute(service, teamId, stations.map(s => s.id))
    await setGameStatus(service, 'live')
  })

  async function submit(code: string, teamCode = 'TEAM-11') {
    const { data, error } = await anon.rpc('submit_code', { p_team_code: teamCode, p_code: code })
    expect(error).toBeNull()
    return data
  }

  it('rejects unknown team codes', async () => {
    expect(await submit('CODE-1', 'NOPE-00')).toEqual({ ok: false, error: 'invalid_team_code' })
  })

  it('rejects submissions when the game is not live', async () => {
    await setGameStatus(service, 'setup')
    expect(await submit('CODE-1')).toEqual({ ok: false, error: 'game_not_live' })
    await setGameStatus(service, 'paused')
    expect(await submit('CODE-1')).toEqual({ ok: false, error: 'game_not_live' })
    const { data: attempts } = await service.from('attempts').select('*')
    expect(attempts).toEqual([])
  })

  it('logs wrong codes without advancing', async () => {
    expect(await submit('WRONG-1')).toEqual({ ok: true, correct: false, reason: 'wrong' })
    const { data: team } = await service.from('teams').select('current_position').eq('id', teamId).single()
    expect(team!.current_position).toBe(0)
    const { data: attempts } = await service.from('attempts').select('*')
    expect(attempts).toHaveLength(1)
    expect(attempts![0]).toMatchObject({ submitted_code: 'WRONG-1', result: 'wrong' })
  })

  it('treats codes from later stations on the route as wrong', async () => {
    expect(await submit('CODE-3')).toEqual({ ok: true, correct: false, reason: 'wrong' })
  })

  it('advances on the correct code, ignoring case and whitespace', async () => {
    expect(await submit('  code-1 ')).toEqual({
      ok: true,
      correct: true,
      finished: false,
      position: 1,
      total: 4,
      clue: 'Clue leading to station 2',
    })
    const { data: team } = await service.from('teams').select('current_position').eq('id', teamId).single()
    expect(team!.current_position).toBe(1)
  })

  it('enforces a 5 second cooldown between attempts', async () => {
    await submit('WRONG-1')
    const blocked = await submit('CODE-1')
    expect(blocked).toMatchObject({ ok: false, error: 'cooldown' })
    expect(blocked.retry_after_seconds).toBeGreaterThan(0)
    expect(blocked.retry_after_seconds).toBeLessThanOrEqual(5)
    // cooldown rejections log nothing, so the window is not extended
    const { data: attempts } = await service.from('attempts').select('*')
    expect(attempts).toHaveLength(1)
    await clearCooldown(service, teamId)
    expect(await submit('CODE-1')).toMatchObject({ correct: true })
  })

  it('flags codes the team already used', async () => {
    await submit('CODE-1')
    await clearCooldown(service, teamId)
    expect(await submit('CODE-1')).toEqual({ ok: true, correct: false, reason: 'already_used' })
    const { data: attempts } = await service.from('attempts').select('result').order('id')
    expect(attempts!.map(a => a.result)).toEqual(['correct', 'already_used'])
  })

  it('finishes the hunt with a rank on the final code, then blocks further submits', async () => {
    for (const code of ['CODE-1', 'CODE-2', 'CODE-3']) {
      expect(await submit(code)).toMatchObject({ correct: true, finished: false })
      await clearCooldown(service, teamId)
    }
    expect(await submit('FINAL-99')).toEqual({
      ok: true,
      correct: true,
      finished: true,
      position: 4,
      total: 4,
      rank: 1,
    })
    const { data: team } = await service.from('teams').select('finished_at').eq('id', teamId).single()
    expect(team!.finished_at).not.toBeNull()
    await clearCooldown(service, teamId)
    expect(await submit('CODE-2')).toEqual({ ok: false, error: 'already_finished' })
  })

  it('ranks later finishers behind earlier ones', async () => {
    for (const code of ['CODE-1', 'CODE-2', 'CODE-3', 'FINAL-99']) {
      await submit(code)
      await clearCooldown(service, teamId)
    }
    const second = await createTeam(service, 'Second', 'TEAM-22')
    await setRoute(service, second.id, stations.map(s => s.id))
    for (const code of ['CODE-1', 'CODE-2', 'CODE-3']) {
      await submit(code, 'TEAM-22')
      await clearCooldown(service, second.id)
    }
    expect(await submit('FINAL-99', 'TEAM-22')).toMatchObject({ finished: true, rank: 2 })
  })
})
