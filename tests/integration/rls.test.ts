import { anonClient, adminClient, serviceClient, resetDb, seedStations } from './helpers'

const service = serviceClient()

describe('row level security', () => {
  beforeEach(async () => {
    await resetDb(service)
    await seedStations(service, 2)
  })

  it('hides every table from anonymous clients', async () => {
    const anon = anonClient()
    for (const table of ['game', 'stations', 'teams', 'route_stops', 'attempts']) {
      const { data, error } = await anon.from(table).select('*')
      expect(error, table).toBeNull()
      expect(data, table).toEqual([])
    }
  })

  it('blocks anonymous writes', async () => {
    const anon = anonClient()
    const { error: insertError } = await anon.from('teams').insert({ name: 'Sneaky', team_code: 'HACK-01' })
    expect(insertError).not.toBeNull()
    const { error: updateError, data } = await anon
      .from('game')
      .update({ status: 'live' })
      .eq('id', 1)
      .select()
    // RLS either errors or matches zero rows — both mean the write did not land
    expect(updateError !== null || data?.length === 0).toBe(true)
    const { data: gameRow } = await service.from('game').select('status').single()
    expect(gameRow!.status).toBe('setup')
  })

  it('gives authenticated admins full access', async () => {
    const admin = await adminClient()
    const { data: stations, error } = await admin.from('stations').select('*')
    expect(error).toBeNull()
    expect(stations).toHaveLength(3)
    const { data: team, error: insertError } = await admin
      .from('teams')
      .insert({ name: 'Admin made', team_code: 'ADMIN-01' })
      .select()
      .single()
    expect(insertError).toBeNull()
    const { error: updateError } = await admin.from('teams').update({ name: 'Renamed' }).eq('id', team!.id)
    expect(updateError).toBeNull()
    const { error: deleteError } = await admin.from('teams').delete().eq('id', team!.id)
    expect(deleteError).toBeNull()
  })
})
