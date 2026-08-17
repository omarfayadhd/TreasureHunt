import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchBoard, fetchRecentAttempts, type AttemptRow, type BoardRow } from './adminApi'
import { sortBoard } from './sortBoard'

export function useAdminBoard() {
  const [rows, setRows] = useState<BoardRow[]>([])
  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [board, recent] = await Promise.all([fetchBoard(), fetchRecentAttempts()])
      setRows(sortBoard(board))
      setAttempts(recent)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    reload()
    const channel = supabase
      .channel('admin-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempts' }, reload)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [reload])

  return { rows, attempts, error, reload }
}
