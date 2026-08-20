import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayerApp from './PlayerApp'
import * as api from '../lib/api'
import type { TeamView } from '../lib/api'

vi.mock('../lib/api', () => ({
  teamView: vi.fn(),
  submitCode: vi.fn(),
  openCard: vi.fn(),
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
    race: { level: 2, found: 1, teams: 3 },
    cards: [
      { level: 1, unlocked: true, opened: true, clue: 'Under the plant', location: 'Lobby' },
      { level: 2, unlocked: true, opened: false, clue: 'Behind the fridge', location: null },
      { level: 3, unlocked: false, opened: false, clue: null, location: null },
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
  // Players are anonymous and get no postgres_changes events under
  // deny-by-default RLS, so the poll is the whole refresh mechanism.
  it('re-reads the view every five seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mockedView.mockResolvedValue(view())
      localStorage.setItem('treasure_team_code', 'ALPHA1')
      render(<PlayerApp />)
      await vi.waitFor(() => expect(mockedView).toHaveBeenCalled())
      const initial = mockedView.mock.calls.length

      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockedView.mock.calls.length).toBe(initial + 1)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(mockedView.mock.calls.length).toBe(initial + 2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flags the final level and coins the rest', async () => {
    await loginAs(view())
    const cards = document.querySelectorAll('.scratch-card')
    expect(cards).toHaveLength(3)
    expect(cards[2].classList.contains('is-final')).toBe(true)
    expect(cards[2].querySelector('[data-sprite="lock"]')).toBeTruthy()
    expect(cards[0].querySelector('[data-sprite="flag"]')).toBeNull()
    expect(cards[1].querySelector('[data-sprite="coin"]')).toBeTruthy()
  })

  it('shows one card per level with locked cards hidden', async () => {
    await loginAs(view())
    expect(await screen.findByText('Under the plant')).toBeInTheDocument()
    expect(screen.getAllByText(/locked/i)).toHaveLength(1)
  })

  it('shows how many teams have found the code it is hunting', async () => {
    await loginAs(view())
    expect(await screen.findByText(/1 of 3 teams found this code/i)).toBeInTheDocument()
  })

  it('reports a scratch to the server', async () => {
    mockedOpen.mockResolvedValue({ ok: true, level: 2, clue: 'Behind the fridge', view: view() })
    await loginAs(view())
    await userEvent.click(await screen.findByRole('button', { name: /scratch to reveal/i }))
    expect(mockedOpen).toHaveBeenCalledWith('ALPHA1', 2)
  })

  it('submits a code and renders the returned view', async () => {
    await loginAs(view())
    mockedSubmit.mockResolvedValue({ ok: true, correct: true, view: view({ cleared: 2, race: { level: 3, found: 0, teams: 3 } }) })
    await userEvent.type(screen.getByLabelText(/enter code/i), 'CODE2')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/code cracked/i)).toBeInTheDocument()
  })

  it('puts the ghost on the wrong-code message', async () => {
    await loginAs(view())
    mockedSubmit.mockResolvedValue({ ok: true, correct: false, reason: 'wrong', view: view() })
    await userEvent.type(screen.getByLabelText(/enter code/i), 'NOPE99')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    const message = await screen.findByText(/wrong code/i)
    expect(message.querySelector('[data-sprite="ghost"]')).toBeTruthy()
  })

  it('shows the winner screen for the first finisher', async () => {
    await loginAs(view({ status: 'winner', cleared: 3, race: null, place: 1 }))
    expect(await screen.findByText(/treasure found/i)).toBeInTheDocument()
  })

  // One treasure, one winner: a team that arrives late is told on the code form
  // and keeps hunting, so no screen ever shows a placing.
  it('never shows a placing', async () => {
    await loginAs(view({ status: 'winner', cleared: 3, race: null, place: 1 }))
    expect(await screen.findByText(/treasure found/i)).toBeInTheDocument()
    expect(screen.queryByText(/\b1st\b|\b2nd\b|\b3rd\b/i)).not.toBeInTheDocument()
  })

  it('waits for kickoff when the game is in setup', async () => {
    await loginAs(view({ game_status: 'setup', race: null }))
    expect(await screen.findByText(/hasn't started/i)).toBeInTheDocument()
  })
})

describe('per-team routes', () => {
  // A location is the answer to its clue, so the server sends it only for levels
  // the team has already cleared. Level 2 is the one being hunted: clue, no place.
  it('names a cleared location but never the one still being hunted', async () => {
    await loginAs(view())
    expect(await screen.findByText('Lobby')).toBeInTheDocument()
    expect(screen.getByText('Behind the fridge')).toBeInTheDocument()
    expect(screen.queryByText('Kitchen')).not.toBeInTheDocument()
  })

  it("says so when the code belongs to another team", async () => {
    await loginAs(view())
    mockedSubmit.mockResolvedValue({ ok: true, correct: false, reason: 'not_your_code', view: view() })
    await userEvent.type(screen.getByLabelText(/enter code/i), 'BBB111')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/belongs to another team/i)).toBeInTheDocument()
  })
})

describe('clue sheet', () => {
  it('opens the styled clue sheet when a card is scratched', async () => {
    const scratched = view({
      cards: [
        { level: 1, unlocked: true, opened: false, clue: 'Two things **begin** here', location: null },
        { level: 2, unlocked: false, opened: false, clue: null, location: null },
      ],
      cleared: 0,
      total: 2,
    })
    // Scratching reports the open, so the view that comes back has to be this
    // team's view — otherwise the sheet would show whatever the stub returned.
    mockedOpen.mockResolvedValue({ ok: true, level: 1, clue: 'Two things **begin** here', view: scratched })
    await loginAs(scratched)

    await userEvent.click(await screen.findByRole('button', { name: /scratch to reveal/i }))
    expect(await screen.findByRole('heading', { name: 'Team 1 – Clue 1' })).toBeInTheDocument()
    expect(screen.getByText('begin').tagName).toBe('STRONG')
  })

  it('closes the clue sheet again', async () => {
    await loginAs(view({
      cards: [{ level: 1, unlocked: true, opened: true, clue: 'Two things begin', location: null }],
      cleared: 0,
      total: 1,
    }))
    await userEvent.click(await screen.findByRole('button', { name: /read the clue/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the claimed treasure', () => {
  it('says the treasure is gone when another team got there first', async () => {
    await loginAs(view())
    mockedSubmit.mockResolvedValue({
      ok: true, correct: false, reason: 'treasure_claimed', view: view(),
    })
    await userEvent.type(screen.getByLabelText(/enter code/i), 'TREAS9')
    await userEvent.click(screen.getByRole('button', { name: /submit code/i }))
    expect(await screen.findByText(/already claimed/i)).toBeInTheDocument()
  })

  it('congratulates the winner without ranking anyone', async () => {
    await loginAs(view({ status: 'winner', cleared: 3, total: 3, place: 1, race: null }))
    expect(await screen.findByText(/treasure found/i)).toBeInTheDocument()
    // One winner, no placings: nothing on screen should read as an ordinal.
    expect(screen.queryByText(/\b1st\b|\b2nd\b|\b3rd\b|finished 1/i)).not.toBeInTheDocument()
  })
})
