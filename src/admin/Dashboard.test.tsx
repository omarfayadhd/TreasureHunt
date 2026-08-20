import { render, screen } from '@testing-library/react'
import Dashboard from './Dashboard'
import { useMonitor } from './useMonitor'
import type { MonitorRow } from './adminApi'

vi.mock('./useMonitor', () => ({ useMonitor: vi.fn() }))

function row(overrides: Partial<MonitorRow>): MonitorRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Team',
    team_code: 'ALPHA1',
    status: 'playing',
    cleared_level: 0,
    out_at_level: null,
    finished_at: null,
    eliminated_at: null,
    created_at: '2026-08-20T09:00:00Z',
    started: false,
    max_opened_level: null,
    last_solve_at: null,
    wrong_count: 0,
    ...overrides,
  }
}

function mount(rows: MonitorRow[], levels = 3) {
  vi.mocked(useMonitor).mockReturnValue({
    rows,
    levels,
    game: { id: 1, status: 'live', started_at: null, ended_at: null, initial_team_count: rows.length },
    error: null,
    loading: false,
  })
  render(<Dashboard />)
}

describe('Dashboard', () => {
  it('separates started teams from those yet to open card 1', () => {
    mount([
      row({ name: 'Movers', started: true, max_opened_level: 2, cleared_level: 1 }),
      row({ name: 'Sleepers', started: false }),
    ])
    expect(screen.getByText('Movers').closest('tr')).toHaveTextContent(/started/i)
    expect(screen.getByText('Sleepers').closest('tr')).toHaveTextContent(/not started/i)
  })

  it('shows how far each team has opened and cleared', () => {
    mount([row({ name: 'Movers', started: true, max_opened_level: 3, cleared_level: 2 })])
    const tr = screen.getByText('Movers').closest('tr')!
    expect(tr).toHaveTextContent('3')
    expect(tr).toHaveTextContent('2')
  })

  it('highlights the winner', () => {
    mount([row({ name: 'Champs', status: 'winner', cleared_level: 3, finished_at: '2026-08-20T10:00:00Z' })])
    expect(screen.getByText('Champs').closest('tr')).toHaveClass('row-winner')
  })

  it('summarises how many teams have finished', () => {
    mount([
      row({ name: 'Champs', status: 'winner', cleared_level: 3, finished_at: '2026-08-20T10:00:00Z' }),
      row({ name: 'Chasers', cleared_level: 1, started: true }),
    ])
    expect(screen.getByText(/1 of 2 teams finished/i)).toBeInTheDocument()
  })

  it('shows where the pack has reached', () => {
    mount([
      row({ name: 'A', cleared_level: 2, started: true }),
      row({ name: 'B', cleared_level: 1, started: true }),
    ])
    expect(screen.getByText(/clue 2/i)).toBeInTheDocument()
  })

  it('marks a later finisher with its placing', () => {
    mount([row({ name: 'Second', status: 'finished', cleared_level: 3, finished_at: '2026-08-20T10:09:00Z' })])
    expect(screen.getByText('Second').closest('tr')).toHaveTextContent(/finished/i)
  })
})
