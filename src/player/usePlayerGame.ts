import { useCallback, useEffect, useRef, useState } from 'react'
import { teamView, submitCode, openCard as openCardApi, subscribeToGame, type TeamView } from '../lib/api'

const STORAGE_KEY = 'treasure_team_code'
const POLL_MS = 30_000

export type Feedback =
  | { kind: 'wrong' | 'already_used' | 'correct' }
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
      const result = await teamView(code)
      if (result.ok) setView(result)
      else forgetTeam()
    } catch {
      // Network hiccup: keep showing the last known view
    }
  }, [forgetTeam])

  const login = useCallback(async (code: string) => {
    setBusy(true)
    setLoginError(null)
    try {
      const result = await teamView(code)
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
    const current = codeRef.current
    if (!current) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await submitCode(current, code)
      if (!result.ok) {
        if (result.error === 'cooldown') setFeedback({ kind: 'cooldown', seconds: result.retry_after_seconds })
        else if (result.error === 'invalid_team_code') forgetTeam()
        else await refresh()
        return
      }
      setView(result.view)
      setFeedback(result.correct ? { kind: 'correct' } : { kind: result.reason })
    } catch {
      setFeedback({ kind: 'error', message: 'Network problem — try again.' })
    } finally {
      setBusy(false)
    }
  }, [forgetTeam, refresh])

  const openCard = useCallback(async (level: number) => {
    const current = codeRef.current
    if (!current) return
    try {
      const result = await openCardApi(current, level)
      if (result.ok) setView(result.view)
      else await refresh()
    } catch {
      setFeedback({ kind: 'error', message: 'Network problem — try again.' })
    }
  }, [refresh])

  useEffect(() => {
    if (!restoring) return
    refresh().finally(() => setRestoring(false))
  }, [restoring, refresh])

  // Rivals clearing levels or finishing change this team's race count and
  // placement without it doing anything, so stay subscribed.
  useEffect(() => {
    if (!teamCode) return
    const unsubscribe = subscribeToGame(() => { void refresh() })
    const interval = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [teamCode, refresh])

  return { view, restoring, loginError, feedback, busy, login, submit, openCard }
}
