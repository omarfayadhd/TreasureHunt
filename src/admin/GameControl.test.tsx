import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import GameControl from './GameControl'
import * as adminApi from './adminApi'

vi.mock('./adminApi', () => ({
  fetchGame: vi.fn(),
  fetchRoutePreview: vi.fn(),
  startGame: vi.fn(),
  pauseGame: vi.fn(),
  resumeGame: vi.fn(),
  endGame: vi.fn(),
  resetProgress: vi.fn(),
  generateRoutes: vi.fn(),
}))

const setupGame = { id: 1, status: 'setup' as const, started_at: null, ended_at: null }

function renderPanel() {
  return render(
    <MemoryRouter>
      <GameControl />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.fetchGame).mockResolvedValue(setupGame)
  vi.mocked(adminApi.fetchRoutePreview).mockResolvedValue([])
})

describe('GameControl', () => {
  it('offers Start in setup and surfaces validation errors', async () => {
    vi.mocked(adminApi.startGame).mockResolvedValue({ ok: false, error: 'teams_missing_routes', teams: 2 })
    renderPanel()
    const startButton = await screen.findByRole('button', { name: /start hunt/i })
    await userEvent.click(startButton)
    expect(await screen.findByText(/teams_missing_routes/i)).toBeInTheDocument()
  })

  it('offers Pause and End while live', async () => {
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    renderPanel()
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /end hunt/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start hunt/i })).not.toBeInTheDocument()
  })

  it('shows the route preview', async () => {
    vi.mocked(adminApi.fetchRoutePreview).mockResolvedValue([
      { team: 'Mongooses', stops: ['Kitchen', 'Lobby', 'Treasure'] },
    ])
    renderPanel()
    expect(await screen.findByText('Mongooses')).toBeInTheDocument()
    expect(screen.getByText('Kitchen → Lobby → Treasure')).toBeInTheDocument()
  })

  it('generates routes on demand', async () => {
    vi.mocked(adminApi.generateRoutes).mockResolvedValue({ ok: true, teams_routed: 3 })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /generate routes/i }))
    await waitFor(() => expect(adminApi.generateRoutes).toHaveBeenCalled())
  })

  it('requires typing RESET before resetting', async () => {
    vi.mocked(adminApi.resetProgress).mockResolvedValue({ ok: true, status: 'setup' })
    renderPanel()
    const resetButton = await screen.findByRole('button', { name: /reset progress/i })
    expect(resetButton).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/type reset/i), 'RESET')
    expect(resetButton).toBeEnabled()
    await userEvent.click(resetButton)
    await waitFor(() => expect(adminApi.resetProgress).toHaveBeenCalled())
  })

  it('surfaces an initial load failure', async () => {
    vi.mocked(adminApi.fetchGame).mockRejectedValue(new Error('network down'))
    renderPanel()
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })
})
