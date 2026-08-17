import { useEffect, useState, type FormEvent } from 'react'
import type { TeamView } from '../lib/api'
import type { Feedback } from './usePlayerGame'

type Props = {
  view: TeamView
  feedback: Feedback | null
  busy: boolean
  onSubmit: (code: string) => void
}

export default function GameScreen({ view, feedback, busy, onSubmit }: Props) {
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
    if (cooldown > 0) return { className: 'msg msg-warn', text: `Whoa, slow down! Try again in ${cooldown}s.` }
    if (!feedback) return null
    switch (feedback.kind) {
      case 'wrong':
        return { className: 'msg msg-bad shake', text: "That's not the right code. Keep hunting!" }
      case 'already_used':
        return { className: 'msg msg-warn', text: "You've already used that code — follow your latest clue!" }
      case 'correct':
        return { className: 'msg msg-good', text: 'Code cracked! Here comes your next clue…' }
      case 'error':
        return { className: 'msg msg-bad', text: feedback.message }
      case 'cooldown':
        return null
    }
  })()

  return (
    <div className="player-screen">
      <header className="player-header">
        <span className="team-name">{view.team_name}</span>
        <span className="progress-label">Clue {view.position + 1} of {view.total}</span>
      </header>
      <div className="progress-dots" aria-hidden="true">
        {Array.from({ length: view.total }, (_, i) => (
          <span key={i} className={i < view.position ? 'dot done' : i === view.position ? 'dot current' : 'dot'} />
        ))}
      </div>
      <div className="clue-card" key={view.position}>
        <h2>Your clue</h2>
        <p>{view.clue}</p>
      </div>
      <form onSubmit={handleSubmit} className="code-form">
        <label htmlFor="code-input">Enter code</label>
        <input
          id="code-input"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="e.g. TIGER-42"
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button type="submit" disabled={busy || cooldown > 0 || !code.trim()}>
          {cooldown > 0 ? `Wait ${cooldown}s…` : 'Submit code'}
        </button>
      </form>
      {message && <p className={message.className} role="status">{message.text}</p>}
    </div>
  )
}
