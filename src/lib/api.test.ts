import { teamView, submitCode, openCard } from './api'
import { supabase } from './supabaseClient'

vi.mock('./supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))
const rpc = vi.mocked(supabase.rpc)

beforeEach(() => vi.clearAllMocks())

describe('api', () => {
  it('calls team_view with the team code', async () => {
    rpc.mockResolvedValue({ data: { ok: true, cards: [] }, error: null } as never)
    await teamView('ALPHA1')
    expect(rpc).toHaveBeenCalledWith('team_view', { p_team_code: 'ALPHA1' })
  })

  it('calls submit_code with the team code and the entered code', async () => {
    rpc.mockResolvedValue({ data: { ok: true, correct: true }, error: null } as never)
    await submitCode('ALPHA1', 'code1')
    expect(rpc).toHaveBeenCalledWith('submit_code', { p_team_code: 'ALPHA1', p_code: 'code1' })
  })

  it('calls open_card with the level', async () => {
    rpc.mockResolvedValue({ data: { ok: true, level: 2 }, error: null } as never)
    await openCard('ALPHA1', 2)
    expect(rpc).toHaveBeenCalledWith('open_card', { p_team_code: 'ALPHA1', p_level: 2 })
  })

  it('throws on a transport error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } } as never)
    await expect(teamView('ALPHA1')).rejects.toMatchObject({ message: 'boom' })
  })
})
