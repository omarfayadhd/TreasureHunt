import { serviceClient, resetDb, seedStations, createTeam } from './helpers'

const service = serviceClient()

describe('schema', () => {
  beforeEach(() => resetDb(service))

  it('has a single game row in setup', async () => {
    const { data, error } = await service.from('game').select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ id: 1, status: 'setup', started_at: null, ended_at: null })
  })

  it('rejects a second game row', async () => {
    const { error } = await service.from('game').insert({ id: 2 })
    expect(error).not.toBeNull()
  })

  it('rejects invalid game statuses', async () => {
    const { error } = await service.from('game').update({ status: 'bogus' }).eq('id', 1)
    expect(error).not.toBeNull()
  })

  it('rejects duplicate station codes', async () => {
    await seedStations(service, 2)
    const { error } = await service.from('stations').insert({ name: 'Dup', clue_text: 'x', code: 'CODE-1' })
    expect(error).not.toBeNull()
  })

  it('allows only one final station', async () => {
    await seedStations(service, 2) // includes one final station
    const { error } = await service
      .from('stations')
      .insert({ name: 'Second final', clue_text: 'x', code: 'OTHER-1', is_final: true })
    expect(error).not.toBeNull()
  })

  it('rejects duplicate team names and codes', async () => {
    await createTeam(service, 'Mongooses', 'TEAM-11')
    const { error: nameError } = await service.from('teams').insert({ name: 'Mongooses', team_code: 'TEAM-22' })
    expect(nameError).not.toBeNull()
    const { error: codeError } = await service.from('teams').insert({ name: 'Other', team_code: 'TEAM-11' })
    expect(codeError).not.toBeNull()
  })

  it('rejects a station appearing twice in one route', async () => {
    const stations = await seedStations(service, 2)
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    const { error } = await service.from('route_stops').insert([
      { team_id: team.id, position: 1, station_id: stations[0].id },
      { team_id: team.id, position: 2, station_id: stations[0].id },
    ])
    expect(error).not.toBeNull()
  })

  it('rejects invalid attempt results', async () => {
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    const { error } = await service
      .from('attempts')
      .insert({ team_id: team.id, submitted_code: 'X', result: 'nope' })
    expect(error).not.toBeNull()
  })
})
