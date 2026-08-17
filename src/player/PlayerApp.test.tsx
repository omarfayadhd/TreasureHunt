import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayerApp from './PlayerApp'
import * as api from '../lib/api'
import type { TeamView } from '../lib/api'

vi.mock('../lib/api', () => ({
  teamLogin: vi.fn(),
  submitCode: vi.fn(),
}))

const mockedLogin = vi.mocked(api.teamLogin)
const mockedSubmit = vi.mocked(api.submitCode)

function liveView(overrides: Partial<TeamView> = {}): TeamView {
  return {
    ok: true,
    team_name: 'Mongooses',
    game_status: 'live',
    position: 1,
    total: 5,
    clue: 'Look under the big plant',
    finished: false,
    rank: null,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

async function loginAs(view: TeamView) {
  mockedLogin.mockResolvedValue(view)
  render(<PlayerApp />)
  await userEvent.type(screen.getByLabelText(/team code/i), 'TIGER-42')
  await userEvent.click(screen.getByRole('button', { name: /let's hunt/i }))
}

describe('PlayerApp', () => {
  it('logs a team in and shows their clue and progress', async () => {
    await loginAs(liveView())
    expect(await screen.findByText('Look under the big plant')).toBeInTheDocument()
    expect(screen.getByText(/clue 2 of 5/i)).toBeInTheDocument()
    expect(screen.getByText('Mongooses')).toBeInTheDocument()
    expect(localStorage.getItem('treasure_team_code')).toBe('TIGER-42')
  })

  it('shows an error for a bad team code', async () => {
    mockedLogin.mockResolvedValue({ ok: false, error: 'invalid_team_code' })
    render(<PlayerApp />)
    await userEvent.type(screen.getByLabelText(/team code/i), 'NOPE-00')
    await userEvent.click(screen.getByRole('button', { name: /let's hunt/i }))
    expect(await screen.findByText(/doesn't match any team/i)).toBeInTheDocument()
    expect(localStorage.getItem('treasure_team_code')).toBeNull()
  })

  it('restores a saved session', async () => {
    localStorage.setItem('treasure_team_code', 'TIGER-42')
    mockedLogin.mockResolvedValue(liveView())
    render(<PlayerApp />)
    expect(await screen.findByText('Look under the big plant')).toBeInTheDocument()
    expect(mockedLogin).toHaveBeenCalledWith('TIGER-42')
  })

  it('shows the waiting screen before the hunt starts', async () => {
    await loginAs(liveView({ game_status: 'setup', clue: null }))
    expect(await screen.findByText(/hold tight, mongooses/i)).toBeInTheDocument()
    expect(screen.getByText(/hasn't started yet/i)).toBeInTheDocument()
  })

  it('shows the paused screen', async () => {
    await loginAs(liveView({ game_status: 'paused', clue: null }))
    expect(await screen.findByText(/the hunt is paused/i)).toBeInTheDocument()
  })

  it('rejects a wrong code with a message', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({ ok: true, correct: false, reason: 'wrong' })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'BAD-99')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/not the right code/i)).toBeInTheDocument()
  })

  it('nudges when a code was already used', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({ ok: true, correct: false, reason: 'already_used' })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'OLD-11')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/already used that code/i)).toBeInTheDocument()
  })

  it('advances to the next clue on a correct code', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({
      ok: true, correct: true, finished: false, position: 2, total: 5, clue: 'Check the coffee machine',
    })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'TIGER-42')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText('Check the coffee machine')).toBeInTheDocument()
    expect(screen.getByText(/clue 3 of 5/i)).toBeInTheDocument()
  })

  it('shows a cooldown countdown and disables submit', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({ ok: false, error: 'cooldown', retry_after_seconds: 4 })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'TIGER-42')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/slow down/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /wait/i })).toBeDisabled()
  })

  it('celebrates the treasure with a rank', async () => {
    await loginAs(liveView())
    mockedSubmit.mockResolvedValue({ ok: true, correct: true, finished: true, position: 5, total: 5, rank: 2 })
    await userEvent.type(await screen.findByLabelText(/enter code/i), 'GOLD-01')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/treasure found!/i)).toBeInTheDocument()
    expect(screen.getByText(/finished 2nd/i)).toBeInTheDocument()
  })

  it('shows the ended screen when the hunt is over', async () => {
    await loginAs(liveView({ game_status: 'ended', clue: null }))
    expect(await screen.findByText(/the hunt is over/i)).toBeInTheDocument()
  })
})
