import { useState, type FormEvent } from 'react'

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
      <h1>🗺️ Office Treasure Hunt</h1>
      <p className="tagline">Crack the clues. Find the codes. Claim the treasure.</p>
      <form onSubmit={handleSubmit} className="code-form">
        <label htmlFor="team-code-input">Team code</label>
        <input
          id="team-code-input"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="e.g. MANGO-77"
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button type="submit" disabled={busy || !code.trim()}>Let's hunt!</button>
      </form>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
    </div>
  )
}
