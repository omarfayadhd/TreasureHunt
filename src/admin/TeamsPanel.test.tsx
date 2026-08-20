import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeamsPanel from './TeamsPanel'
import * as adminApi from './adminApi'
import type { MonitorRow } from './adminApi'

vi.mock('./adminApi', () => ({
  fetchMonitor: vi.fn(),
  fetchGame: vi.fn(),
  createTeam: vi.fn(),
  updateTeamName: vi.fn(),
  regenerateTeamCode: vi.fn(),
  deleteTeam: vi.fn(),
  generateTeams: vi.fn(),
  refusal: (result: unknown) =>
    result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok === false
      ? ((result as { error?: string }).error ?? 'unknown')
      : null,
}))

const setupGame = {
  id: 1,
  status: 'setup' as const,
  started_at: null,
  ended_at: null,
  initial_team_count: null,
  treasure_station_id: null,
  treasure_code: null,
}

function row(overrides: Partial<MonitorRow>): MonitorRow {
  return {
    current_location: null,
    too_late_at: null,
    id: 'team-1',
    name: 'Mongooses',
    team_code: 'TIGER42',
    status: 'playing',
    cleared_level: 2,
    out_at_level: null,
    finished_at: null,
    eliminated_at: null,
    created_at: '2026-08-17T09:00:00Z',
    started: true,
    max_opened_level: 2,
    last_solve_at: null,
    wrong_count: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.fetchGame).mockResolvedValue(setupGame)
})

describe('TeamsPanel', () => {
  it('lists teams with codes and progress', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([row({})])
    render(<TeamsPanel />)
    expect(await screen.findByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('TIGER42')).toBeInTheDocument()
    const tr = screen.getByText('Mongooses').closest('tr')!
    const cells = within(tr).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('2')
  })

  it('creates a team and reloads', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    vi.mocked(adminApi.createTeam).mockResolvedValue({ ok: true })
    render(<TeamsPanel />)
    await userEvent.type(await screen.findByLabelText(/new team name/i), 'The Owls')
    await userEvent.click(screen.getByRole('button', { name: /add team/i }))
    await waitFor(() => expect(adminApi.createTeam).toHaveBeenCalledWith('The Owls'))
    expect(vi.mocked(adminApi.fetchMonitor).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('surfaces an action failure', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    vi.mocked(adminApi.createTeam).mockRejectedValue(new Error('create failed'))
    render(<TeamsPanel />)
    await userEvent.type(await screen.findByLabelText(/new team name/i), 'The Owls')
    await userEvent.click(screen.getByRole('button', { name: /add team/i }))
    expect(await screen.findByText(/create failed/i)).toBeInTheDocument()
  })

  it('surfaces an initial load failure', async () => {
    vi.mocked(adminApi.fetchMonitor).mockRejectedValue(new Error('network down'))
    render(<TeamsPanel />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })

  it('generates teams from a count', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    vi.mocked(adminApi.generateTeams).mockResolvedValue({ ok: true, created: 3, total: 3 })
    render(<TeamsPanel />)
    await userEvent.clear(screen.getByLabelText(/number of teams/i))
    await userEvent.type(screen.getByLabelText(/number of teams/i), '3')
    await userEvent.click(screen.getByRole('button', { name: /generate teams/i }))
    expect(adminApi.generateTeams).toHaveBeenCalledWith(3)
    expect(await screen.findByText(/added 3 teams/i)).toBeInTheDocument()
  })

  it('surfaces the refusal when the game is already live', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    vi.mocked(adminApi.generateTeams).mockResolvedValue({ ok: false, error: 'game_live' })
    render(<TeamsPanel />)
    await userEvent.clear(screen.getByLabelText(/number of teams/i))
    await userEvent.type(screen.getByLabelText(/number of teams/i), '4')
    await userEvent.click(screen.getByRole('button', { name: /generate teams/i }))
    expect(await screen.findByText(/end or reset the game first/i)).toBeInTheDocument()
  })

  it('locks every destructive team action while the hunt is running', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([row({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    render(<TeamsPanel />)
    expect(await screen.findByText(/teams are locked/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^rename$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /new code/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /add team/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /generate teams/i })).toBeDisabled()
    expect(screen.getByLabelText(/new team name/i)).toBeDisabled()
  })

  it('treats a paused hunt as running', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([row({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'paused' })
    render(<TeamsPanel />)
    expect(await screen.findByRole('button', { name: /new code/i })).toBeDisabled()
  })

  it('surfaces a server refusal from the New code button', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([row({})])
    vi.mocked(adminApi.regenerateTeamCode).mockResolvedValue({ ok: false, error: 'game_running' })
    render(<TeamsPanel />)
    await userEvent.click(await screen.findByRole('button', { name: /new code/i }))
    expect(await screen.findByText(/end or reset the game first/i)).toBeInTheDocument()
  })

  it('surfaces a thrown error from Generate teams instead of swallowing it', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    vi.mocked(adminApi.generateTeams).mockRejectedValue(new Error('teams_name_key duplicate'))
    render(<TeamsPanel />)
    await userEvent.clear(screen.getByLabelText(/number of teams/i))
    await userEvent.type(screen.getByLabelText(/number of teams/i), '3')
    await userEvent.click(screen.getByRole('button', { name: /generate teams/i }))
    expect(await screen.findByText(/teams_name_key duplicate/i)).toBeInTheDocument()
  })

  it('rejects a non-integer or sub-1 count before calling the server', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    render(<TeamsPanel />)
    await userEvent.clear(screen.getByLabelText(/number of teams/i))
    await userEvent.type(screen.getByLabelText(/number of teams/i), '0')
    await userEvent.click(screen.getByRole('button', { name: /generate teams/i }))
    expect(await screen.findByText(/whole number of teams/i)).toBeInTheDocument()
    expect(adminApi.generateTeams).not.toHaveBeenCalled()
  })

  it('rejects a count above the server cap of 50 before calling the server', async () => {
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    render(<TeamsPanel />)
    await userEvent.clear(screen.getByLabelText(/number of teams/i))
    await userEvent.type(screen.getByLabelText(/number of teams/i), '999')
    await userEvent.click(screen.getByRole('button', { name: /generate teams/i }))
    expect(await screen.findByText(/between 1 and 50/i)).toBeInTheDocument()
    expect(adminApi.generateTeams).not.toHaveBeenCalled()
  })
})
