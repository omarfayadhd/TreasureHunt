import { render, screen } from '@testing-library/react'
import PrintPage from './PrintPage'
import * as adminApi from './adminApi'

vi.mock('./adminApi', () => ({
  fetchStations: vi.fn(),
  fetchMonitor: vi.fn(),
}))

describe('PrintPage', () => {
  it('renders station cards and team slips', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      { id: 's1', name: 'Kitchen', clue_text: 'x', code: 'BEAN42', sort_order: 1 },
      { id: 's2', name: 'Vault', clue_text: 'y', code: 'GOLD99', sort_order: 2 },
    ])
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([
      {
        id: 't1', name: 'Mongooses', team_code: 'TIGER42', status: 'playing',
        cleared_level: 0, out_at_level: null, finished_at: null, eliminated_at: null,
        created_at: '2026-08-17T09:00:00Z', started: false, max_opened_level: null,
        last_solve_at: null, wrong_count: 0,
      },
    ])
    render(<PrintPage />)
    expect(await screen.findByText('BEAN42')).toBeInTheDocument()
    expect(screen.getByText(/post at: kitchen/i)).toBeInTheDocument()
    expect(screen.getByText(/final treasure/i)).toBeInTheDocument()
    expect(screen.getByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('TIGER42')).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    vi.mocked(adminApi.fetchStations).mockRejectedValue(new Error('network down'))
    vi.mocked(adminApi.fetchMonitor).mockResolvedValue([])
    render(<PrintPage />)
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })
})
