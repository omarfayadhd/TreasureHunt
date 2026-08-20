import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import GameControl from './GameControl'
import * as adminApi from './adminApi'

vi.mock('./adminApi', () => ({
  fetchGame: vi.fn(),
  startGame: vi.fn(),
  pauseGame: vi.fn(),
  resumeGame: vi.fn(),
  endGame: vi.fn(),
  resetProgress: vi.fn(),
}))

const setupGame = { id: 1, status: 'setup' as const, started_at: null, ended_at: null, initial_team_count: null }

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
})

describe('GameControl', () => {
  it('offers Start in setup and surfaces validation errors', async () => {
    vi.mocked(adminApi.startGame).mockResolvedValue({ ok: false, error: 'no_teams' })
    renderPanel()
    const startButton = await screen.findByRole('button', { name: /start hunt/i })
    await userEvent.click(startButton)
    expect(await screen.findByText(/add teams before starting/i)).toBeInTheDocument()
  })

  it('explains a level gap in plain language', async () => {
    vi.mocked(adminApi.startGame).mockResolvedValue({ ok: false, error: 'level_gap' })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /start/i }))
    expect(await screen.findByText(/levels must run 1, 2, 3/i)).toBeInTheDocument()
  })

  it('reports the shape of the game it just started', async () => {
    vi.mocked(adminApi.startGame).mockResolvedValue({ ok: true, status: 'live', teams: 4, levels: 4 })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /start/i }))
    expect(await screen.findByText(/4 teams · 4 clues/i)).toBeInTheDocument()
  })

  it('offers Pause and End while live', async () => {
    vi.mocked(adminApi.fetchGame).mockResolvedValue({ ...setupGame, status: 'live' })
    renderPanel()
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /end hunt/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start hunt/i })).not.toBeInTheDocument()
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
