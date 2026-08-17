import { useCallback, useEffect, useRef, useState } from 'react'
import { teamLogin, submitCode, type TeamView } from '../lib/api'

const STORAGE_KEY = 'treasure_team_code'
const POLL_MS = 30_000

export type Feedback =
  | { kind: 'wrong' }
  | { kind: 'already_used' }
  | { kind: 'correct' }
  | { kind: 'cooldown'; seconds: number }
  | { kind: 'error'; message: string }

export function usePlayerGame() {
  const [teamCode, setTeamCode] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))
  const [view, setView] = useState<TeamView | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(() => localStorage.getItem(STORAGE_KEY) !== null)
  const codeRef = useRef(teamCode)
  codeRef.current = teamCode

  const forgetTeam = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setTeamCode(null)
    setView(null)
  }, [])

  const refresh = useCallback(async () => {
    const code = codeRef.current
    if (!code) return
    try {
      const result = await teamLogin(code)
      if (result.ok) setView(result)
      else forgetTeam()
    } catch {
      // Network hiccup while polling: keep the current view
    }
  }, [forgetTeam])

  const login = useCallback(async (code: string) => {
    setBusy(true)
    setLoginError(null)
    try {
      const result = await teamLogin(code)
      if (result.ok) {
        localStorage.setItem(STORAGE_KEY, code)
        setTeamCode(code)
        setView(result)
      } else {
        setLoginError("That team code doesn't match any team. Double-check it!")
      }
    } catch {
      setLoginError('Network problem — try again.')
    } finally {
      setBusy(false)
    }
  }, [])

  const submit = useCallback(async (code: string) => {
    const currentTeamCode = codeRef.current
    if (!currentTeamCode) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await submitCode(currentTeamCode, code)
      if (!result.ok) {
        if (result.error === 'cooldown') {
          setFeedback({ kind: 'cooldown', seconds: result.retry_after_seconds })
        } else if (result.error === 'invalid_team_code') {
          forgetTeam()
        } else {
          // game_not_live or already_finished: resync the whole view
          await refresh()
        }
      } else if (!result.correct) {
        setFeedback({ kind: result.reason })
      } else {
        setFeedback({ kind: 'correct' })
        setView(v => v && {
          ...v,
          position: result.position,
          total: result.total,
          clue: result.finished ? null : result.clue,
          finished: result.finished,
          rank: result.finished ? result.rank : null,
        })
      }
    } catch {
      setFeedback({ kind: 'error', message: 'Network problem — try again.' })
    } finally {
      setBusy(false)
    }
  }, [forgetTeam, refresh])

  // Restore a saved session on first mount
  useEffect(() => {
    if (!restoring) return
    refresh().finally(() => setRestoring(false))
  }, [restoring, refresh])

  // Poll for admin overrides and game-state changes
  useEffect(() => {
    if (!teamCode) return
    const interval = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [teamCode, refresh])

  return { view, restoring, loginError, feedback, busy, login, submit }
}
