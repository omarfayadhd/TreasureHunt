import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayerApp from './PlayerApp'
import * as api from '../lib/api'
import type { TeamView } from '../lib/api'

vi.mock('../lib/api', () => ({
  teamView: vi.fn(),
  submitCode: vi.fn(),
  openCard: vi.fn(),
  subscribeToGame: vi.fn(() => () => {}),
}))

const mockedView = vi.mocked(api.teamView)
const mockedSubmit = vi.mocked(api.submitCode)
const mockedOpen = vi.mocked(api.openCard)

function view(overrides: Partial<TeamView> = {}): TeamView {
  return {
    ok: true,
    team_name: 'Team 1',
    game_status: 'live',
    status: 'playing',
    cleared: 1,
    total: 3,
    out_at_level: null,
    place: null,
    race: { level: 2, slots: 2, taken: 1 },
    cards: [
      { level: 1, unlocked: true, opened: true, clue: 'Under the plant' },
      { level: 2, unlocked: true, opened: false, clue: 'Behind the fridge' },
      { level: 3, unlocked: false, opened: false, clue: null },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

async function loginAs(v: TeamView) {
  mockedView.mockResolvedValue(v)
  render(<PlayerApp />)
  await userEvent.type(screen.getByLabelText(/team code/i), 'ALPHA1')
  await userEvent.click(screen.getByRole('button', { name: /let's hunt/i }))
}

describe('PlayerApp', () => {
  it('shows one card per level with locked cards hidden', async () => {
    await loginAs(view())
    expect(await screen.findByText('Under the plant')).toBeInTheDocument()
    expect(screen.getAllByText(/locked/i)).toHaveLength(1)
  })

  it('shows the live race count', async () => {
    await loginAs(view())
    expect(await screen.findByText(/1 of 2 codes found/i)).toBeInTheDocument()
    expect(screen.getByText(/1 slot left/i)).toBeInTheDocument()
  })

  it('warns when only one slot remains', async () => {
    await loginAs(view({ race: { level: 2, slots: 2, taken: 1 } }))
    expect(await screen.findByText(/1 slot left/i)).toHaveClass('race-urgent')
  })

  it('reports a scratch to the server', async () => {
    mockedOpen.mockResolvedValue({ ok: true, level: 2, clue: 'Behind the fridge', view: view() })
    await loginAs(view())
    await userEvent.click(await screen.findByRole('button', { name: /scratch to reveal/i }))
    expect(mockedOpen).toHaveBeenCalledWith('ALPHA1', 2)
  })

  it('submits a code and renders the returned view', async () => {
    await loginAs(view())
    mockedSubmit.mockResolvedValue({ ok: true, correct: true, view: view({ cleared: 2, race: { level: 3, slots: 1, taken: 0 } }) })
    await userEvent.type(screen.getByLabelText(/enter code/i), 'CODE2')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/code cracked/i)).toBeInTheDocument()
  })

  it('shows the too-late message when the slots filled first', async () => {
    await loginAs(view())
    mockedSubmit.mockResolvedValue({
      ok: true, correct: false, reason: 'too_late',
      view: view({ status: 'eliminated', out_at_level: 2, race: null, place: 3 }),
    })
    await userEvent.type(screen.getByLabelText(/enter code/i), 'CODE2')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/game over/i)).toBeInTheDocument()
  })

  it('switches to the eliminated screen with the level reached', async () => {
    await loginAs(view({ status: 'eliminated', out_at_level: 2, race: null, place: 3 }))
    expect(await screen.findByText(/game over/i)).toBeInTheDocument()
    expect(screen.getByText(/other teams found all the codes/i)).toBeInTheDocument()
    expect(screen.getByText(/clue 2 of 3/i)).toBeInTheDocument()
  })

  it('celebrates the winner', async () => {
    await loginAs(view({ status: 'winner', cleared: 3, race: null, place: 1 }))
    expect(await screen.findByText(/treasure found/i)).toBeInTheDocument()
  })

  it('shows the placing for a later finisher', async () => {
    await loginAs(view({ status: 'finished', cleared: 3, race: null, place: 2 }))
    expect(await screen.findByText(/2nd/i)).toBeInTheDocument()
  })

  it('waits for kickoff when the game is in setup', async () => {
    await loginAs(view({ game_status: 'setup', race: null }))
    expect(await screen.findByText(/hasn't started/i)).toBeInTheDocument()
  })
})
