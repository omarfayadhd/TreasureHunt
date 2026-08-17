import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeamsPanel from './TeamsPanel'
import * as adminApi from './adminApi'
import type { BoardRow } from './adminApi'

vi.mock('./adminApi', () => ({
  fetchBoard: vi.fn(),
  createTeam: vi.fn(),
  updateTeamName: vi.fn(),
  regenerateTeamCode: vi.fn(),
  deleteTeam: vi.fn(),
  setTeamPosition: vi.fn(),
}))

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    id: 'team-1',
    name: 'Mongooses',
    team_code: 'TIGER-42',
    current_position: 2,
    finished_at: null,
    created_at: '2026-08-17T09:00:00Z',
    total: 5,
    next_station: 'Kitchen',
    last_solve_at: null,
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('TeamsPanel', () => {
  it('lists teams with codes and progress', async () => {
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([row({})])
    render(<TeamsPanel />)
    expect(await screen.findByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('TIGER-42')).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
  })

  it('creates a team and reloads', async () => {
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([])
    vi.mocked(adminApi.createTeam).mockResolvedValue(undefined)
    render(<TeamsPanel />)
    await userEvent.type(await screen.findByLabelText(/new team name/i), 'The Owls')
    await userEvent.click(screen.getByRole('button', { name: /add team/i }))
    await waitFor(() => expect(adminApi.createTeam).toHaveBeenCalledWith('The Owls'))
    expect(vi.mocked(adminApi.fetchBoard).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('advances and rolls back a team', async () => {
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([row({})])
    vi.mocked(adminApi.setTeamPosition).mockResolvedValue({ ok: true, position: 3 })
    render(<TeamsPanel />)
    await userEvent.click(await screen.findByRole('button', { name: '+1' }))
    expect(adminApi.setTeamPosition).toHaveBeenCalledWith('team-1', 3)
    await userEvent.click(screen.getByRole('button', { name: '-1' }))
    expect(adminApi.setTeamPosition).toHaveBeenCalledWith('team-1', 1)
  })

  it('surfaces an rpc business failure', async () => {
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([row({})])
    vi.mocked(adminApi.setTeamPosition).mockResolvedValue({ ok: false, error: 'invalid_team' })
    render(<TeamsPanel />)
    await userEvent.click(await screen.findByRole('button', { name: '+1' }))
    expect(await screen.findByText(/invalid_team/i)).toBeInTheDocument()
  })

  it('surfaces an initial load failure', async () => {
    vi.mocked(adminApi.fetchBoard).mockRejectedValue(new Error('network down'))
    render(<TeamsPanel />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })
})
