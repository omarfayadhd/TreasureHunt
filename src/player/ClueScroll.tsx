import { useEffect } from 'react'
import ClueText from '../lib/ClueText'

type Props = {
  teamName: string
  level: number
  clue: string
  onClose: () => void
}

/**
 * The clue on a sheet of aged paper, opened once a card is scratched. Spans come
 * from parseClue as data, so a clue can never inject markup — the worst an admin
 * can do is write angle brackets that read as angle brackets.
 */
export default function ClueScroll({ teamName, level, clue, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scroll-backdrop" data-testid="scroll-backdrop" onClick={onClose}>
      <div
        className="scroll-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${teamName} – Clue ${level}`}
        onClick={event => event.stopPropagation()}
      >
        <h2 className="scroll-title">{`${teamName} – Clue ${level}`}</h2>
        <p className="scroll-divider" aria-hidden="true">❖</p>
        <ClueText clue={clue} className="scroll-body" />
        <p className="scroll-divider" aria-hidden="true">❖</p>
        <button type="button" className="scroll-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
