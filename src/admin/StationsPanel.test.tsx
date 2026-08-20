import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StationsPanel from './StationsPanel'
import * as adminApi from './adminApi'
import type { MonitorRow, RouteCell, StationRow } from './adminApi'

vi.mock('./adminApi', () => ({
  fetchStations: vi.fn(),
  setTreasure: vi.fn(),
  setTreasureCode: vi.fn(),
  clearTreasure: vi.fn(),
  createStation: vi.fn(),
  updateStation: vi.fn(),
  deleteStation: vi.fn(),
  swapOrder: vi.fn(),
  fetchGame: vi.fn(),
  fetchMonitor: vi.fn(),
  fetchRoutes: vi.fn(),
  setRouteCell: vi.fn(),
  setRouteCode: vi.fn(),
  clearRouteCell: vi.fn(),
  refusal: (result: unknown) =>
    result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok === false
      ? ((result as { error?: string }).error ?? 'unknown')
      : null,
}))

function station(overrides: Partial<StationRow>): StationRow {
  return {
    id: 'station-1',
    name: 'Kitchen',
    clue_text: 'Where the coffee lives',
    sort_order: 1,
    ...overrides,
  }
}

function monitorRow(overrides: Partial<MonitorRow>): MonitorRow {
  return {
    id: 'team-1',
    name: 'Team 1',
    team_code: 'ALPHA1',
    status: 'playing',
    cleared_level: 0,
    out_at_level: null,
    finished_at: null,
    eliminated_at: null,
    created_at: '2026-08-20T00:00:00Z',
    started: false,
    max_opened_level: null,
    last_solve_at: null,
    wrong_count: 0,
    current_location: null,
    too_late_at: null,
    ...overrides,
  }
}

const setupGame = {
  id: 1,
  status: 'setup' as const,
  started_at: null,
  ended_at: null,
  initial_team_count: null,
  treasure_station_id: null,
  treasure_code: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.fetchGame).mockResolvedValue(setupGame)
  vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
  vi.mocked(adminApi.fetchRoutes).mockResolvedValue([])
})

describe('StationsPanel', () => {
  it('lists locations with their clues', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Treasure spot', clue_text: 'You have arrived', sort_order: 2 }),
    ])
    render(<StationsPanel />)
    // Location names also appear in the treasure picker, so read the table.
    const table = (await screen.findByRole('table')).closest('table')!
    expect(table).toHaveTextContent('Kitchen')
    expect(table).toHaveTextContent('Treasure spot')
    expect(screen.getByText('Where the coffee lives')).toBeInTheDocument()
  })

  it('creates a location with no code of its own', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([])
    vi.mocked(adminApi.createStation).mockResolvedValue(undefined)
    render(<StationsPanel />)
    await userEvent.type(await screen.findByLabelText(/location name/i), 'Reception')
    await userEvent.type(screen.getByLabelText(/clue/i), 'Where visitors wait')
    await userEvent.click(screen.getByRole('button', { name: /add location/i }))
    await waitFor(() =>
      expect(adminApi.createStation).toHaveBeenCalledWith({
        name: 'Reception',
        clue_text: 'Where visitors wait',
        sort_order: 1,
      }),
    )
  })

  it('warns when the game is running', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([station({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    render(<StationsPanel />)
    expect(await screen.findByText(/hunt is live/i)).toBeInTheDocument()
  })

  it('surfaces an initial load failure', async () => {
    vi.mocked(adminApi.fetchStations).mockRejectedValue(new Error('network down'))
    render(<StationsPanel />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })

  it('blocks every location edit while the game is running', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Treasure spot', sort_order: 2 }),
    ])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    render(<StationsPanel />)
    expect(await screen.findAllByRole('button', { name: /delete/i })).toHaveLength(2)
    for (const button of screen.getAllByRole('button', { name: /delete/i })) expect(button).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: /edit/i })) expect(button).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: /↑|↓/ })) expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: /add location/i })).toBeDisabled()
    expect(screen.getByLabelText(/location name/i)).toBeDisabled()
  })

  it('treats a paused hunt as running', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([station({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'paused' })
    render(<StationsPanel />)
    expect(await screen.findByRole('button', { name: /add location/i })).toBeDisabled()
  })

  it('reorders a location through the server-side swap', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Treasure spot', sort_order: 2 }),
    ])
    vi.mocked(adminApi.swapOrder).mockResolvedValue({ ok: true })
    render(<StationsPanel />)
    const upButtons = await screen.findAllByRole('button', { name: '↑' })
    await userEvent.click(upButtons[1])
    await waitFor(() =>
      expect(adminApi.swapOrder).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'station-2' }),
        expect.objectContaining({ id: 'station-1' }),
      ),
    )
  })

  it('surfaces the server refusal when reordering during a running hunt', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Treasure spot', sort_order: 2 }),
    ])
    vi.mocked(adminApi.swapOrder).mockResolvedValue({ ok: false, error: 'game_running' })
    render(<StationsPanel />)
    const upButtons = await screen.findAllByRole('button', { name: '↑' })
    await userEvent.click(upButtons[1])
    expect(await screen.findByText(/end it or reset progress/i)).toBeInTheDocument()
  })

  it('hosts the team-route grid on the same page', async () => {
    const stations = [station({}), station({ id: 'station-2', name: 'Treasure spot', sort_order: 2 })]
    const routes: RouteCell[] = [
      { team_id: 'team-1', level: 1, station_id: 'station-1', code: 'AAA111' },
      { team_id: 'team-2', level: 1, station_id: 'station-2', code: 'BBB111' },
    ]
    vi.mocked(adminApi.fetchStations).mockResolvedValue(stations)
    vi.mocked(adminApi.fetchRoutes).mockResolvedValue(routes)
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([
      monitorRow({}),
      monitorRow({ id: 'team-2', name: 'Team 2', team_code: 'BETA22' }),
    ])

    render(<StationsPanel />)
    expect(await screen.findByRole('heading', { name: /team routes/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Team 1 level 1 location')).toHaveValue('station-1')
    expect(screen.getByLabelText('Team 2 level 1 location')).toHaveValue('station-2')
    expect(screen.getByText('AAA111')).toBeInTheDocument()
  })

  it('locks the route grid while the hunt runs', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([station({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([monitorRow({})])
    vi.mocked(adminApi.fetchRoutes).mockResolvedValue([
      { team_id: 'team-1', level: 1, station_id: 'station-1', code: 'AAA111' },
    ])
    render(<StationsPanel />)
    expect(await screen.findByLabelText('Team 1 level 1 location')).toBeDisabled()
  })
})

describe('StationsPanel clue formatting', () => {
  it('takes a multi-line clue in a textarea', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([])
    vi.mocked(adminApi.createStation).mockResolvedValue(undefined)
    render(<StationsPanel />)
    const clue = await screen.findByLabelText(/clue/i)
    expect(clue.tagName).toBe('TEXTAREA')

    await userEvent.type(await screen.findByLabelText(/location name/i), 'Reception')
    await userEvent.type(clue, 'Two things **begin**{enter}your journey')
    await userEvent.click(screen.getByRole('button', { name: /add location/i }))
    await waitFor(() =>
      expect(adminApi.createStation).toHaveBeenCalledWith({
        name: 'Reception',
        clue_text: 'Two things **begin**\nyour journey',
        sort_order: 1,
      }),
    )
  })

  it('previews the clue the way the team will read it', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([])
    render(<StationsPanel />)
    await userEvent.type(await screen.findByLabelText(/clue/i), 'Two things **begin**')
    const preview = screen.getByTestId('clue-preview')
    expect(preview).toHaveTextContent('Two things begin')
    expect(preview.querySelector('strong')?.textContent).toBe('begin')
  })

  it('spells out the formatting a clue understands', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([])
    render(<StationsPanel />)
    expect(await screen.findByText(/\*\*bold\*\*/)).toBeInTheDocument()
  })
})

describe('StationsPanel treasure', () => {
  it('asks for a treasure location and shows nothing set yet', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([station({})])
    render(<StationsPanel />)
    expect(await screen.findByRole('heading', { name: /treasure/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/treasure location/i)).toHaveValue('')
    expect(screen.getByText(/no treasure set/i)).toBeInTheDocument()
  })

  it('sets the treasure location', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Vault', sort_order: 2 }),
    ])
    vi.mocked(adminApi.setTreasure).mockResolvedValue({ ok: true, code: 'TREAS9' })
    render(<StationsPanel />)
    await userEvent.selectOptions(await screen.findByLabelText(/treasure location/i), 'station-2')
    await waitFor(() => expect(adminApi.setTreasure).toHaveBeenCalledWith('station-2'))
  })

  it('shows the treasure code and reissues it', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([station({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({
      ...setupGame, treasure_station_id: 'station-1', treasure_code: 'TREAS9',
    })
    vi.mocked(adminApi.setTreasureCode).mockResolvedValue({ ok: true, code: 'FRESH1' })
    render(<StationsPanel />)
    expect(await screen.findByText('TREAS9')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /new treasure code/i }))
    await waitFor(() => expect(adminApi.setTreasureCode).toHaveBeenCalled())
  })

  it('explains a treasure location a team already walks through', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Vault', sort_order: 2 }),
    ])
    vi.mocked(adminApi.setTreasure).mockResolvedValue({ ok: false, error: 'location_used_by_team' })
    render(<StationsPanel />)
    await userEvent.selectOptions(await screen.findByLabelText(/treasure location/i), 'station-2')
    expect(await screen.findByText(/already on a team's route/i)).toBeInTheDocument()
  })

  it('locks the treasure controls while the hunt runs', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([station({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({
      ...setupGame, status: 'live', treasure_station_id: 'station-1', treasure_code: 'TREAS9',
    })
    render(<StationsPanel />)
    expect(await screen.findByLabelText(/treasure location/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /new treasure code/i })).toBeDisabled()
  })
})
