import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ScratchCard from './ScratchCard'
import type { Card } from '../lib/api'

function card(overrides: Partial<Card> = {}): Card {
  return { level: 2, unlocked: true, opened: false, clue: 'Behind the coffee machine', ...overrides }
}

describe('ScratchCard', () => {
  it('shows a padlock and no clue for a locked card', () => {
    render(<ScratchCard card={card({ unlocked: false, clue: null })} isCurrent={false} onOpen={vi.fn()} />)
    expect(screen.getByText(/locked/i)).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows the clue outright once opened', () => {
    render(<ScratchCard card={card({ opened: true })} isCurrent onOpen={vi.fn()} />)
    expect(screen.getByText('Behind the coffee machine')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers a reveal control for an unopened card and reports the open once', async () => {
    const onOpen = vi.fn()
    render(<ScratchCard card={card()} isCurrent onOpen={onOpen} />)
    const button = screen.getByRole('button', { name: /scratch|reveal/i })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(2)
  })

  it('keeps the clue in the accessibility tree while still covered', () => {
    render(<ScratchCard card={card()} isCurrent onOpen={vi.fn()} />)
    expect(screen.getByText('Behind the coffee machine')).toBeInTheDocument()
  })
})
