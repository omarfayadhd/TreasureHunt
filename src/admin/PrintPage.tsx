import { useEffect, useState } from 'react'
import { fetchBoard, fetchStations, type BoardRow, type StationRow } from './adminApi'

export default function PrintPage() {
  const [stations, setStations] = useState<StationRow[]>([])
  const [teams, setTeams] = useState<BoardRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchStations()
      .then(setStations)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
    fetchBoard()
      .then(rows => setTeams([...rows].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <div className="print-page">
      <div className="no-print card">
        <h2>Print sheets</h2>
        <p>Station cards to post at each location, and team slips to hand out. Cut along the dashed lines.</p>
        <button onClick={() => window.print()}>Print</button>
        {error && <p className="msg msg-bad" role="alert">{error}</p>}
      </div>
      <section className="print-section">
        {stations.map(station => (
          <div className="print-card" key={station.id}>
            <p className="print-eyebrow">
              🗺️ Office Treasure Hunt{station.is_final ? ' · FINAL TREASURE' : ''}
            </p>
            <p className="print-code">{station.code}</p>
            <p className="print-small">Post at: {station.name}</p>
          </div>
        ))}
      </section>
      <section className="print-section">
        {teams.map(team => (
          <div className="print-card" key={team.id}>
            <p className="print-eyebrow">🗺️ Office Treasure Hunt</p>
            <p className="print-team">{team.name}</p>
            <p className="print-code">{team.team_code}</p>
            <p className="print-small">Open the hunt site and enter this team code to begin.</p>
          </div>
        ))}
      </section>
    </div>
  )
}
