import { render, screen } from '@testing-library/react'
import PrintPage from './PrintPage'
import * as adminApi from './adminApi'
import type { MonitorRow } from './adminApi'

vi.mock('./adminApi', () => ({
  fetchStations: vi.fn(),
  fetchMonitor: vi.fn(),
  fetchRoutes: vi.fn(),
  fetchGame: vi.fn(),
}))

function team(id: string, name: string, code: string): MonitorRow {
  return {
    id, name, team_code: code, status: 'playing',
    cleared_level: 0, out_at_level: null, finished_at: null, eliminated_at: null,
    created_at: '2026-08-17T09:00:00Z', started: false, max_opened_level: null,
    last_solve_at: null, wrong_count: 0, current_location: null, too_late_at: null,
  }
}

const setupGame = {
  id: 1, status: 'setup' as const, started_at: null, ended_at: null, initial_team_count: null,
  treasure_station_id: null, treasure_code: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.fetchRoutes).mockResolvedValue([])
  vi.mocked(adminApi.fetchGame).mockResolvedValue(setupGame)
})

describe('PrintPage', () => {
  it('groups the slips by location, one per team, and each code once', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      { id: 's1', name: 'Kitchen', clue_text: 'x', sort_order: 1 },
      { id: 's2', name: 'Vault', clue_text: 'y', sort_order: 2 },
    ])
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([
      team('t1', 'Mongooses', 'TIGER42'),
      team('t2', 'Owls', 'OWLS11'),
    ])
    // Staggered: each team visits both locations, at opposite levels.
    vi.mocked(adminApi.fetchRoutes).mockResolvedValue([
      { team_id: 't1', level: 1, station_id: 's1', code: 'AAA111' },
      { team_id: 't1', level: 2, station_id: 's2', code: 'AAA222' },
      { team_id: 't2', level: 1, station_id: 's2', code: 'BBB111' },
      { team_id: 't2', level: 2, station_id: 's1', code: 'BBB222' },
    ])
    render(<PrintPage />)

    expect(await screen.findByText(/post at: kitchen/i)).toBeInTheDocument()
    expect(screen.getByText(/post at: vault/i)).toBeInTheDocument()
    // Every code is printed exactly once: as a location slip, plus the admin sheet.
    for (const code of ['AAA111', 'AAA222', 'BBB111', 'BBB222']) {
      expect(screen.getAllByText(code)).toHaveLength(2)
    }
    // Both team names appear under each location heading.
    expect(screen.getAllByText('Mongooses').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Owls').length).toBeGreaterThanOrEqual(2)
    // Route slips are all staggered legs now; the treasure gets its own sheet
    // and there is no treasure set in this case.
    expect(screen.queryByText(/the treasure/i)).not.toBeInTheDocument()
  })

  it('still prints the team login slips', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([])
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([team('t1', 'Mongooses', 'TIGER42')])
    render(<PrintPage />)
    expect(await screen.findByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('TIGER42')).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    vi.mocked(adminApi.fetchStations).mockRejectedValue(new Error('network down'))
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    render(<PrintPage />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })
})

describe('PrintPage treasure', () => {
  it('prints one treasure sheet with the single shared code', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      { id: 's1', name: 'Kitchen', clue_text: 'x', sort_order: 1 },
      { id: 's2', name: 'Vault', clue_text: 'y', sort_order: 2 },
    ])
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([team('t1', 'Owls', 'OWLS11')])
    vi.mocked(adminApi.fetchRoutes).mockResolvedValue([
      { team_id: 't1', level: 1, station_id: 's1', code: 'AAA111' },
    ])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({
      ...setupGame, treasure_station_id: 's2', treasure_code: 'TREAS9',
    })
    render(<PrintPage />)

    expect(await screen.findByText(/· THE TREASURE/)).toBeInTheDocument()
    expect(screen.getByText(/post at: vault/i)).toBeInTheDocument()
    // One slip for the whole field, plus the line on the admin master sheet.
    expect(screen.getAllByText('TREAS9')).toHaveLength(2)
  })
})
