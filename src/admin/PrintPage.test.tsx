import { render, screen } from '@testing-library/react'
import PrintPage from './PrintPage'
import * as adminApi from './adminApi'

vi.mock('./adminApi', () => ({
  fetchStations: vi.fn(),
  fetchBoard: vi.fn(),
}))

describe('PrintPage', () => {
  it('renders station cards and team slips', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      { id: 's1', name: 'Kitchen', clue_text: 'x', code: 'BEAN-42', is_final: false, sort_order: 1 },
      { id: 's2', name: 'Vault', clue_text: 'y', code: 'GOLD-99', is_final: true, sort_order: 2 },
    ])
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([
      {
        id: 't1', name: 'Mongooses', team_code: 'TIGER-42', current_position: 0,
        finished_at: null, created_at: '2026-08-17T09:00:00Z', total: 0,
        next_station: null, last_solve_at: null,
      },
    ])
    render(<PrintPage />)
    expect(await screen.findByText('BEAN-42')).toBeInTheDocument()
    expect(screen.getByText(/post at: kitchen/i)).toBeInTheDocument()
    expect(screen.getByText(/final treasure/i)).toBeInTheDocument()
    expect(screen.getByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('TIGER-42')).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    vi.mocked(adminApi.fetchStations).mockRejectedValue(new Error('network down'))
    vi.mocked(adminApi.fetchBoard).mockResolvedValue([])
    render(<PrintPage />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })
})
