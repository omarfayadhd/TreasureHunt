import { useEffect, useState, type FormEvent } from 'react'
import type { TeamView } from '../lib/api'
import type { Feedback } from './usePlayerGame'
import ScratchCard from './ScratchCard'
import RaceStatus from './RaceStatus'
import { GhostSprite } from './sprites'

type Props = {
  view: TeamView
  feedback: Feedback | null
  busy: boolean
  onSubmit: (code: string) => void
  onOpen: (level: number) => void
}

export default function CardGrid({ view, feedback, busy, onSubmit, onOpen }: Props) {
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (feedback?.kind === 'cooldown') setCooldown(feedback.seconds)
    if (feedback?.kind === 'correct') setCode('')
  }, [feedback])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!code.trim() || busy || cooldown > 0) return
    onSubmit(code)
  }

  const message = (() => {
    if (cooldown > 0) return { className: 'msg msg-warn', text: `Hold on — try again in ${cooldown}s.` }
    if (!feedback) return null
    switch (feedback.kind) {
      case 'wrong':
        return { className: 'msg msg-bad shake', text: 'Wrong code. Keep hunting!', ghost: true }
      case 'already_used':
        return { className: 'msg msg-warn', text: "You've used that one — follow your newest clue!" }
      case 'correct':
        return { className: 'msg msg-good', text: 'Code cracked! Next card unlocked.' }
      case 'error':
        return { className: 'msg msg-bad', text: feedback.message }
      case 'cooldown':
        return null
    }
  })()

  const currentLevel = view.cleared + 1

  return (
    <div className="player-screen">
      <header className="player-header">
        <span className="team-chip">{view.team_name}</span>
        <span className="progress-label">
          Level {Math.min(currentLevel, view.total)} of {view.total}
        </span>
      </header>

      {view.race && <RaceStatus race={view.race} />}

      <div className="scratch-grid">
        {view.cards.map(card => (
          <ScratchCard
            key={card.level}
            card={card}
            isCurrent={card.level === currentLevel}
            isFinal={card.level === view.total}
            onOpen={onOpen}
          />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="code-form">
        <div className="float-field">
          <input
            id="code-input"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="e.g. TIGER42"
            autoComplete="off"
            autoCapitalize="characters"
          />
          <label htmlFor="code-input">Enter code</label>
          <fieldset aria-hidden="true"><legend><span>Enter code</span></legend></fieldset>
        </div>
        <button type="submit" disabled={busy || cooldown > 0 || !code.trim()}>
          {cooldown > 0 ? `Wait ${cooldown}s…` : 'Submit code'}
        </button>
      </form>

      {message && (
        <p className={message.className} role="status">
          {'ghost' in message && message.ghost && <GhostSprite className="sprite sprite-sm" />}
          {message.text}
        </p>
      )}
    </div>
  )
}
