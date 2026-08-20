import { useEffect, useState } from 'react'
import {
  fetchMonitor, fetchRoutes, fetchStations, type MonitorRow, type RouteCell, type StationRow,
} from './adminApi'

export default function PrintPage() {
  const [stations, setStations] = useState<StationRow[]>([])
  const [teams, setTeams] = useState<MonitorRow[]>([])
  const [routes, setRoutes] = useState<RouteCell[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    fetchStations().then(setStations).catch(fail)
    fetchMonitor()
      .then(rows => setTeams([...rows].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(fail)
    fetchRoutes().then(setRoutes).catch(fail)
  }, [])

  const teamName = (id: string) => teams.find(t => t.id === id)?.name ?? 'Unknown team'
  const routeLength = routes.length ? Math.max(...routes.map(r => r.level)) : 0

  return (
    <div className="print-page">
      <div className="no-print card">
        <h2>Print sheets</h2>
        <p>
          One sheet per location: every team that visits it has its own code, so the slips go up side
          by side at the same place. Team login slips follow. Cut along the dashed lines.
        </p>
        <button onClick={() => window.print()}>Print</button>
        {error && <p className="msg msg-bad" role="alert">{error}</p>}
      </div>

      {stations.map(station => {
        const here = routes
          .filter(cell => cell.station_id === station.id)
          .sort((a, b) => teamName(a.team_id).localeCompare(teamName(b.team_id)))
        if (here.length === 0) return null
        return (
          <section className="print-section" key={station.id}>
            <h3 className="print-heading">Post at: {station.name}</h3>
            {here.map(cell => (
              <div className="print-card" key={`${cell.team_id}:${cell.level}`}>
                <p className="print-eyebrow">
                  🗺️ Treasure Hunt · Level {cell.level}
                  {cell.level === routeLength ? ' · FINAL TREASURE' : ''}
                </p>
                <p className="print-team">{teamName(cell.team_id)}</p>
                <p className="print-code">{cell.code}</p>
                <p className="print-small">Only this team's code. Others get "belongs to another team".</p>
              </div>
            ))}
          </section>
        )
      })}

      <section className="print-section">
        {teams.map(team => (
          <div className="print-card" key={team.id}>
            <p className="print-eyebrow">🗺️ Treasure Hunt</p>
            <p className="print-team">{team.name}</p>
            <p className="print-code">{team.team_code}</p>
            <p className="print-small">Open the hunt site and enter this team code to begin.</p>
          </div>
        ))}
      </section>

      <section className="print-section">
        {teams.map(team => {
          const mine = routes.filter(cell => cell.team_id === team.id).sort((a, b) => a.level - b.level)
          if (mine.length === 0) return null
          return (
            <div className="print-card print-sheet" key={`clues-${team.id}`}>
              <p className="print-eyebrow">🗺️ Treasure Hunt · master sheet · ADMIN COPY, do not hand out</p>
              <p className="print-team">{team.name}</p>
              <ol className="print-clues">
                {mine.map(cell => {
                  const station = stations.find(s => s.id === cell.station_id)
                  return (
                    <li key={cell.level}>
                      <strong>Level {cell.level}:</strong> {station?.name ?? 'Unknown location'} —{' '}
                      {station?.clue_text ?? ''} <code>{cell.code}</code>
                    </li>
                  )
                })}
              </ol>
            </div>
          )
        })}
      </section>
    </div>
  )
}
