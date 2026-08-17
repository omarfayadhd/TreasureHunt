import { anonClient, adminClient, serviceClient, resetDb, seedStations, createTeam, setRoute, setGameStatus } from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

const service = serviceClient()
const anon = anonClient()
let admin: SupabaseClient

beforeAll(async () => {
  admin = await adminClient()
})

describe('admin_board view', () => {
  beforeEach(() => resetDb(service))

  it('summarizes team progress for admins', async () => {
    const stations = await seedStations(service, 2)
    const team = await createTeam(service, 'Mongooses', 'TEAM-11')
    await setRoute(service, team.id, stations.map(s => s.id))
    await setGameStatus(service, 'live')
    await anon.rpc('submit_code', { p_team_code: 'TEAM-11', p_code: 'CODE-1' })

    const { data, error } = await admin.from('admin_board').select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({
      name: 'Mongooses',
      team_code: 'TEAM-11',
      current_position: 1,
      total: 3,
      next_station: 'Station 2',
      finished_at: null,
    })
    expect(data![0].last_solve_at).not.toBeNull()
  })

  it('shows null next_station for teams without routes', async () => {
    await createTeam(service, 'Routeless', 'TEAM-22')
    const { data } = await admin.from('admin_board').select('*')
    expect(data![0]).toMatchObject({ name: 'Routeless', total: 0, next_station: null, last_solve_at: null })
  })

  it('returns nothing to anonymous clients', async () => {
    await createTeam(service, 'Hidden', 'TEAM-33')
    const { data, error } = await anon.from('admin_board').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
