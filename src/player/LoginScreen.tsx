import { useState, type FormEvent } from 'react'
import { ChestSprite } from './sprites'

type Props = {
  onLogin: (code: string) => void
  error: string | null
  busy: boolean
}

export default function LoginScreen({ onLogin, error, busy }: Props) {
  const [code, setCode] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (code.trim() && !busy) onLogin(code.trim())
  }

  return (
    <div className="player-screen login-screen">
      <div className="login-card">
        <div className="brand-badge" aria-hidden="true"><ChestSprite className="sprite sprite-xl" /></div>
        <h1>Welcome</h1>
        <form onSubmit={handleSubmit} className="code-form">
          <div className="float-field">
            <input
              id="team-code-input"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="e.g. MANGO77"
              autoComplete="off"
              autoCapitalize="characters"
            />
            <label htmlFor="team-code-input">Enter your team code</label>
            {/* Draws the outline with a gap the floated label sits in. */}
            <fieldset aria-hidden="true"><legend><span>Enter your team code</span></legend></fieldset>
          </div>
          <button type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Checking…' : "Let's hunt!"}
          </button>
        </form>
        {error && <p className="msg msg-bad" role="alert">{error}</p>}
      </div>
    </div>
  )
}
