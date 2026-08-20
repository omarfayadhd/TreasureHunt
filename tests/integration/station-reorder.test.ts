import { beforeEach, describe, expect, it } from 'vitest'
import { adminClient, anonClient, resetDb, seedStations, serviceClient, setGameStatus } from './helpers'

const service = serviceClient()

async function levels() {
  const { data, error } = await service.from('stations').select('name, sort_order').order('sort_order')
  if (error) throw new Error(error.message)
  return data as { name: string; sort_order: number }[]
}

beforeEach(async () => {
  await resetDb(service)
})

describe('swap_station_levels', () => {
  it('swaps two adjacent levels without tripping the unique constraint', async () => {
    const stations = await seedStations(service, 3)
    const admin = await adminClient()

    const { data, error } = await admin.rpc('swap_station_levels', {
      p_a: stations[0].id,
      p_b: stations[1].id,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true })

    expect(await levels()).toEqual([
      { name: 'Station 2', sort_order: 1 },
      { name: 'Station 1', sort_order: 2 },
      { name: 'Station 3', sort_order: 3 },
    ])
  })

  it('swaps non-adjacent levels too, leaving the ladder contiguous', async () => {
    const stations = await seedStations(service, 3)
    const admin = await adminClient()

    expect(await admin.rpc('swap_station_levels', { p_a: stations[0].id, p_b: stations[2].id })
      .then(r => r.data)).toMatchObject({ ok: true })

    expect((await levels()).map(s => s.name)).toEqual(['Station 3', 'Station 2', 'Station 1'])
    expect((await levels()).map(s => s.sort_order)).toEqual([1, 2, 3])
  })

  it('refuses to reorder while the hunt is running', async () => {
    const stations = await seedStations(service, 3)
    const admin = await adminClient()
    await setGameStatus(service, 'live')

    expect(await admin.rpc('swap_station_levels', { p_a: stations[0].id, p_b: stations[1].id })
      .then(r => r.data)).toMatchObject({ ok: false, error: 'game_running' })
    expect((await levels()).map(s => s.name)).toEqual(['Station 1', 'Station 2', 'Station 3'])
  })

  it('reports a missing station instead of throwing', async () => {
    const stations = await seedStations(service, 2)
    const admin = await adminClient()
    expect(await admin.rpc('swap_station_levels', {
      p_a: stations[0].id,
      p_b: '00000000-0000-0000-0000-000000000000',
    }).then(r => r.data)).toMatchObject({ ok: false, error: 'not_found' })
  })

  it('is not callable anonymously', async () => {
    const stations = await seedStations(service, 2)
    const { error } = await anonClient().rpc('swap_station_levels', {
      p_a: stations[0].id,
      p_b: stations[1].id,
    })
    expect(error).not.toBeNull()
  })
})
