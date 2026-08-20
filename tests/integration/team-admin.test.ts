import { beforeEach, describe, expect, it } from 'vitest'
import {
  adminClient, anonClient, createTeam, resetDb, seedStations, serviceClient, setGameStatus,
} from './helpers'

const service = serviceClient()
const anon = anonClient()

async function teamRows() {
  const { data, error } = await service.from('teams').select('id, name, team_code').order('name')
  if (error) throw new Error(error.message)
  return data as { id: string; name: string; team_code: string }[]
}

beforeEach(async () => {
  await resetDb(service)
})

describe('create_team', () => {
  it('mints a server-side code from the strong generator', async () => {
    const admin = await adminClient()
    const { data, error } = await admin.rpc('create_team', { p_name: 'The Mongooses' })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: true, name: 'The Mongooses' })
    // random_team_code(): six characters from a 32-symbol alphabet with no I/O/0/1.
    expect((data as { team_code: string }).team_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })

  it('rejects a duplicate name instead of throwing a constraint error', async () => {
    const admin = await adminClient()
    await admin.rpc('create_team', { p_name: 'Owls' })
    expect(await admin.rpc('create_team', { p_name: 'Owls' }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'name_taken' })
  })

  it('rejects a blank name', async () => {
    const admin = await adminClient()
    expect(await admin.rpc('create_team', { p_name: '   ' }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'bad_name' })
  })

  it('refuses while the hunt is live', async () => {
    const admin = await adminClient()
    await setGameStatus(service, 'live')
    expect(await admin.rpc('create_team', { p_name: 'Latecomers' }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'game_running' })
    expect(await teamRows()).toHaveLength(0)
  })

  it('refuses while the hunt is paused', async () => {
    const admin = await adminClient()
    await setGameStatus(service, 'paused')
    expect(await admin.rpc('create_team', { p_name: 'Latecomers' }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'game_running' })
  })

  it('is not callable anonymously', async () => {
    const { error } = await anon.rpc('create_team', { p_name: 'Sneaky' })
    expect(error).not.toBeNull()
  })
})

describe('regenerate_team_code', () => {
  it('replaces the code with a fresh strong one', async () => {
    const admin = await adminClient()
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    const { data } = await admin.rpc('regenerate_team_code', { p_team_id: team.id })
    expect(data).toMatchObject({ ok: true })
    const fresh = (data as { team_code: string }).team_code
    expect(fresh).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(fresh).not.toBe('ALPHA1')
    expect((await teamRows())[0].team_code).toBe(fresh)
  })

  it('refuses mid-hunt so a printed slip cannot be invalidated', async () => {
    const admin = await adminClient()
    await seedStations(service, 2)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')

    expect(await admin.rpc('regenerate_team_code', { p_team_id: team.id }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'game_running' })
    expect((await teamRows())[0].team_code).toBe('ALPHA1')
  })

  it('reports a missing team', async () => {
    const admin = await adminClient()
    expect(await admin.rpc('regenerate_team_code', {
      p_team_id: '00000000-0000-0000-0000-000000000000',
    }).then(r => r.data)).toMatchObject({ ok: false, error: 'not_found' })
  })

  it('is not callable anonymously', async () => {
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    const { error } = await anon.rpc('regenerate_team_code', { p_team_id: team.id })
    expect(error).not.toBeNull()
  })
})

describe('delete_team', () => {
  it('deletes a team while the game is in setup', async () => {
    const admin = await adminClient()
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    expect(await admin.rpc('delete_team', { p_team_id: team.id }).then(r => r.data))
      .toMatchObject({ ok: true })
    expect(await teamRows()).toHaveLength(0)
  })

  it('refuses mid-hunt so progress is not cascaded away', async () => {
    const admin = await adminClient()
    await seedStations(service, 2)
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')
    await service.from('card_opens').insert({ team_id: team.id, level: 1 })

    expect(await admin.rpc('delete_team', { p_team_id: team.id }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'game_running' })
    expect(await teamRows()).toHaveLength(1)
    const { data: opens } = await service.from('card_opens').select('*').eq('team_id', team.id)
    expect(opens).toHaveLength(1)
  })

  it('is not callable anonymously', async () => {
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    const { error } = await anon.rpc('delete_team', { p_team_id: team.id })
    expect(error).not.toBeNull()
  })
})

describe('rename_team', () => {
  it('renames while in setup and refuses a clashing name', async () => {
    const admin = await adminClient()
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await createTeam(service, 'Team 2', 'BETA22')

    expect(await admin.rpc('rename_team', { p_team_id: team.id, p_name: 'Owls' }).then(r => r.data))
      .toMatchObject({ ok: true, name: 'Owls' })
    expect(await admin.rpc('rename_team', { p_team_id: team.id, p_name: 'Team 2' }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'name_taken' })
  })

  it('refuses mid-hunt', async () => {
    const admin = await adminClient()
    const team = await createTeam(service, 'Team 1', 'ALPHA1')
    await setGameStatus(service, 'live')
    expect(await admin.rpc('rename_team', { p_team_id: team.id, p_name: 'Owls' }).then(r => r.data))
      .toMatchObject({ ok: false, error: 'game_running' })
  })
})

