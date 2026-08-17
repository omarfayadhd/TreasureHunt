import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StationsPanel from './StationsPanel'
import * as adminApi from './adminApi'
import type { StationRow } from './adminApi'

vi.mock('./adminApi', () => ({
  fetchStations: vi.fn(),
  createStation: vi.fn(),
  updateStation: vi.fn(),
  deleteStation: vi.fn(),
  makeFinal: vi.fn(),
  swapOrder: vi.fn(),
  fetchGame: vi.fn(),
}))

vi.mock('../lib/codes', () => ({ generateCode: () => 'AUTO-11' }))

function station(overrides: Partial<StationRow>): StationRow {
  return {
    id: 'station-1',
    name: 'Kitchen',
    clue_text: 'Where the coffee lives',
    code: 'BEAN-42',
    is_final: false,
    sort_order: 1,
    ...overrides,
  }
}

const setupGame = { id: 1, status: 'setup' as const, started_at: null, ended_at: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.fetchGame).mockResolvedValue(setupGame)
})

describe('StationsPanel', () => {
  it('lists stations with clues and codes', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Treasure spot', clue_text: 'You have arrived', code: 'GOLD-99', is_final: true, sort_order: 2 }),
    ])
    render(<StationsPanel />)
    expect(await screen.findByText('Kitchen')).toBeInTheDocument()
    expect(screen.getByText('Where the coffee lives')).toBeInTheDocument()
    expect(screen.getByText('BEAN-42')).toBeInTheDocument()
    expect(screen.getByText('🏆 Final')).toBeInTheDocument()
  })

  it('creates a station with the generated code', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([])
    vi.mocked(adminApi.createStation).mockResolvedValue(undefined)
    render(<StationsPanel />)
    await userEvent.type(await screen.findByLabelText(/station name/i), 'Reception')
    await userEvent.type(screen.getByLabelText(/clue/i), 'Where visitors wait')
    await userEvent.click(screen.getByRole('button', { name: /add station/i }))
    await waitFor(() =>
      expect(adminApi.createStation).toHaveBeenCalledWith({
        name: 'Reception',
        clue_text: 'Where visitors wait',
        code: 'AUTO-11',
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

  it('blocks station deletion while the game is running', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([station({})])
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    render(<StationsPanel />)
    expect(await screen.findByRole('button', { name: /delete/i })).toBeDisabled()
  })
})
