import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ClueScroll from './ClueScroll'

describe('ClueScroll', () => {
  it('heads the sheet with the team name and the clue number', () => {
    render(<ClueScroll teamName="Team 1" level={1} clue="Two things begin" onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Team 1 – Clue 1' })).toBeInTheDocument()
  })

  it('renders bold and italic runs as real emphasis, not asterisks', () => {
    render(
      <ClueScroll teamName="Team 1" level={2} clue="Two things **begin** your *journey*" onClose={vi.fn()} />,
    )
    expect(screen.getByText('begin').tagName).toBe('STRONG')
    expect(screen.getByText('journey').tagName).toBe('EM')
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('draws a divider where the clue asks for one', () => {
    const { container } = render(
      <ClueScroll teamName="Team 1" level={1} clue={'Two things begin:\n\n---\n\nWhere now?'} onClose={vi.fn()} />,
    )
    // The sheet always frames the clue with an ornament above and below; this
    // counts only dividers the clue itself asked for.
    expect(container.querySelectorAll('.scroll-body .clue-divider')).toHaveLength(1)
  })

  it('shows raw HTML in a clue as literal text', () => {
    render(<ClueScroll teamName="Team 1" level={1} clue="<b>not bold</b>" onClose={vi.fn()} />)
    expect(screen.getByText('<b>not bold</b>')).toBeInTheDocument()
    expect(document.querySelector('.scroll-body b')).toBeNull()
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    render(<ClueScroll teamName="Team 1" level={1} clue="x" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<ClueScroll teamName="Team 1" level={1} clue="x" onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a backdrop click but not on a click inside the sheet', async () => {
    const onClose = vi.fn()
    render(<ClueScroll teamName="Team 1" level={1} clue="Two things begin" onClose={onClose} />)
    await userEvent.click(screen.getByText('Two things begin'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('scroll-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is a modal dialog for assistive tech', () => {
    render(<ClueScroll teamName="Team 1" level={1} clue="x" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})
