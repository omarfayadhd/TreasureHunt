import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) setError(signInError.message)
    setBusy(false)
  }

  return (
    <div className="admin-login">
      <form onSubmit={handleSubmit} className="card">
        <h1>Game Master Login</h1>
        <label htmlFor="admin-email">Email</label>
        <input id="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <label htmlFor="admin-password">Password</label>
        <input id="admin-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit" disabled={busy}>Sign in</button>
        {error && <p className="msg msg-bad" role="alert">{error}</p>}
      </form>
    </div>
  )
}
