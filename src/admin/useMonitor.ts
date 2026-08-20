import { useCallback, useEffect, useState } from 'react'
import { subscribeToGame } from '../lib/api'
import { comparePlacement } from '../lib/rounds'
import { countStations, fetchGame, fetchMonitor, type GameRow, type MonitorRow } from './adminApi'

export function useMonitor() {
  const [rows, setRows] = useState<MonitorRow[]>([])
  const [levels, setLevels] = useState(0)
  const [game, setGame] = useState<GameRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [monitor, stationCount, gameRow] = await Promise.all([fetchMonitor(), countStations(), fetchGame()])
      setRows([...monitor].sort(comparePlacement))
      setLevels(stationCount)
      setGame(gameRow)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the board')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = subscribeToGame(() => { void load() })
    const interval = setInterval(load, 15_000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [load])

  return { rows, levels, game, error, loading }
}
