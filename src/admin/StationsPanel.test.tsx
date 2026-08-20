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
  swapOrder: vi.fn(),
  fetchGame: vi.fn(),
  refusal: (result: unknown) =>
    result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok === false
      ? ((result as { error?: string }).error ?? 'unknown')
      : null,
}))

vi.mock('../lib/codes', () => ({ generateCode: () => 'AUTO11' }))

function station(overrides: Partial<StationRow>): StationRow {
  return {
    id: 'station-1',
    name: 'Kitchen',
    clue_text: 'Where the coffee lives',
    code: 'BEAN-42',
    sort_order: 1,
    ...overrides,
  }
}

const setupGame = { id: 1, status: 'setup' as const, started_at: null, ended_at: null, initial_team_count: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.fetchGame).mockResolvedValue(setupGame)
})

describe('StationsPanel', () => {
  it('lists stations with clues and codes', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Treasure spot', clue_text: 'You have arrived', code: 'GOLD-99', sort_order: 2 }),
    ])
    render(<StationsPanel />)
    expect(await screen.findByText('Kitchen')).toBeInTheDocument()
    expect(screen.getByText('Where the coffee lives')).toBeInTheDocument()
    expect(screen.getByText('BEAN-42')).toBeInTheDocument()
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
        code: 'AUTO11',
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

  it('labels the ordering column as level', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      { id: '1', name: 'Kitchen', clue_text: 'Where the mugs live', code: 'KITCH1', sort_order: 1 },
    ])
    render(<StationsPanel />)
    expect(await screen.findByText(/level/i)).toBeInTheDocument()
  })

  it('rejects a code with a space or symbol before saving', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([])
    render(<StationsPanel />)
    await userEvent.type(screen.getByLabelText(/name/i), 'Kitchen')
    await userEvent.type(screen.getByLabelText(/clue/i), 'Where the mugs live')
    await userEvent.type(screen.getByLabelText(/code/i), 'NOT OK!')
    await userEvent.click(screen.getByRole('button', { name: /add station/i }))
    expect(await screen.findByText(/letters and numbers only/i)).toBeInTheDocument()
    expect(adminApi.createStation).not.toHaveBeenCalled()
  })

  it('reorders a level through the server-side swap', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      station({}),
      station({ id: 'station-2', name: 'Treasure spot', code: 'GOLD99', sort_order: 2 }),
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
      station({ id: 'station-2', name: 'Treasure spot', code: 'GOLD99', sort_order: 2 }),
    ])
    vi.mocked(adminApi.swapOrder).mockResolvedValue({ ok: false, error: 'game_running' })
    render(<StationsPanel />)
    const upButtons = await screen.findAllByRole('button', { name: '↑' })
    await userEvent.click(upButtons[1])
    expect(await screen.findByText(/end it or reset progress/i)).toBeInTheDocument()
  })

  it('warns when levels are not contiguous from 1', async () => {
    vi.mocked(adminApi.fetchStations).mockResolvedValue([
      { id: '1', name: 'A', clue_text: 'a', code: 'AAA1', sort_order: 1 },
      { id: '2', name: 'C', clue_text: 'c', code: 'CCC3', sort_order: 3 },
    ])
    render(<StationsPanel />)
    expect(await screen.findByText(/levels must run 1 to 2/i)).toBeInTheDocument()
  })
})
