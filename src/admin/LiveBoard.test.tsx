import { render, screen } from '@testing-library/react'
import LiveBoard from './LiveBoard'
import { useAdminBoard } from './useAdminBoard'
import type { BoardRow } from './adminApi'

vi.mock('./useAdminBoard', () => ({ useAdminBoard: vi.fn() }))

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Team',
    team_code: 'X-00',
    current_position: 0,
    finished_at: null,
    created_at: '2026-08-17T09:00:00Z',
    total: 5,
    next_station: null,
    last_solve_at: null,
    ...overrides,
  }
}

describe('LiveBoard', () => {
  it('renders teams with progress, next station and finish badges', () => {
    vi.mocked(useAdminBoard).mockReturnValue({
      rows: [
        row({ name: 'Winners', current_position: 5, finished_at: '2026-08-17T10:00:00Z' }),
        row({ name: 'Hunters', current_position: 2, next_station: 'Kitchen fridge' }),
      ],
      attempts: [
        {
          id: 1,
          submitted_code: 'BAD-99',
          result: 'wrong',
          created_at: new Date().toISOString(),
          teams: { name: 'Hunters' },
        },
      ],
      reload: vi.fn(),
    })
    render(<LiveBoard />)
    expect(screen.getByText('Winners')).toBeInTheDocument()
    expect(screen.getByText(/finished 1st/i)).toBeInTheDocument()
    expect(screen.getByText('Kitchen fridge')).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
    expect(screen.getByText('BAD-99')).toBeInTheDocument()
  })

  it('shows empty states', () => {
    vi.mocked(useAdminBoard).mockReturnValue({ rows: [], attempts: [], reload: vi.fn() })
    render(<LiveBoard />)
    expect(screen.getByText(/no teams yet/i)).toBeInTheDocument()
    expect(screen.getByText(/no guesses yet/i)).toBeInTheDocument()
  })
})
