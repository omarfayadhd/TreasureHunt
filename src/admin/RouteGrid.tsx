import { useState } from 'react'
import {
  clearRouteCell, refusal, setRouteCell, setRouteCode, type RouteCell, type StationRow,
} from './adminApi'

export type RouteTeam = { id: string; name: string }

type Props = {
  teams: RouteTeam[]
  stations: StationRow[]
  rows: RouteCell[]
  disabled: boolean
  onReload: () => void
}

const key = (teamId: string, level: number) => `${teamId}:${level}`

/**
 * Everything that would make the hunt unplayable, in the admin's words. The
 * server refuses a bad kickoff anyway; this says why before they try.
 */
export function routeIssues(teams: RouteTeam[], stations: StationRow[], rows: RouteCell[]): string[] {
  const issues: string[] = []
  if (teams.length === 0) return issues

  // The staggering rule needs one free location per team at every level.
  if (stations.length < teams.length) {
    issues.push(
      `Add at least ${teams.length} locations — ${teams.length} teams cannot be kept apart with ${stations.length}.`,
    )
  }

  // Every team runs the same number of levels, so the longest route sets the
  // target: a shorter one reads as the cells it is missing, level by level.
  const target = rows.length ? Math.max(...rows.map(r => r.level)) : 0
  const lengths = new Map<string, number>()
  for (const team of teams) {
    const levels = rows.filter(r => r.team_id === team.id).map(r => r.level)
    lengths.set(team.id, levels.length)
    if (levels.length === 0) {
      issues.push(`${team.name} has no route yet.`)
      continue
    }
    for (let level = 1; level <= target; level++) {
      if (!levels.includes(level)) issues.push(`${team.name} has no level ${level} stop.`)
    }
  }

  const routed = teams.filter(t => (lengths.get(t.id) ?? 0) > 0)
  const distinct = new Set(routed.map(t => lengths.get(t.id)))
  if (distinct.size > 1) {
    const spread = routed.map(t => `${t.name} has ${lengths.get(t.id)}`).join(', ')
    issues.push(`Every route must be the same length: ${spread}.`)
  }

  return issues
}

export default function RouteGrid({ teams, stations, rows, disabled, onReload }: Props) {
  const [error, setError] = useState<string | null>(null)

  const cells = new Map(rows.map(r => [key(r.team_id, r.level), r]))
  const highest = rows.length ? Math.max(...rows.map(r => r.level)) : 0
  // One spare column so any route can be extended by a level.
  const levels = Array.from({ length: highest + 1 }, (_, i) => i + 1)
  const issues = routeIssues(teams, stations, rows)

  function message(code: string, team: RouteTeam, level: number, stationName: string): string {
    switch (code) {
      case 'location_taken_at_level':
        return `${stationName} is already another team's level ${level} stop.`
      case 'location_used_by_team':
        return `${team.name} already visits ${stationName} at another level.`
      case 'game_running':
        return 'The hunt is running — end it or reset progress before editing routes.'
      case 'not_found':
        return 'That stop is no longer there — the grid has been refreshed.'
      default:
        return `Error: ${code}`
    }
  }

  async function run(
    action: () => Promise<unknown>,
    team: RouteTeam,
    level: number,
    stationName: string,
  ) {
    setError(null)
    try {
      const refused = refusal(await action())
      if (refused) setError(message(refused, team, level, stationName))
      onReload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleChange(team: RouteTeam, level: number, stationId: string) {
    if (disabled) return
    if (!stationId) {
      void run(() => clearRouteCell(team.id, level), team, level, '')
      return
    }
    const name = stations.find(s => s.id === stationId)?.name ?? 'That location'
    void run(() => setRouteCell(team.id, level, stationId), team, level, name)
  }

  if (teams.length === 0) {
    return <p className="empty">Add teams first — routes are built per team.</p>
  }

  return (
    <>
      {issues.length > 0 && (
        <ul className="msg msg-warn">
          {issues.map(issue => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      <table className="board-table route-grid">
        <thead>
          <tr>
            <th>Team</th>
            {levels.map(level => <th key={level}>Level {level}</th>)}
          </tr>
        </thead>
        <tbody>
          {teams.map(team => (
            <tr key={team.id}>
              <td>{team.name}</td>
              {levels.map(level => {
                const cell = cells.get(key(team.id, level))
                return (
                  <td key={level}>
                    <select
                      aria-label={`${team.name} level ${level} location`}
                      value={cell?.station_id ?? ''}
                      disabled={disabled}
                      onChange={e => handleChange(team, level, e.target.value)}
                    >
                      <option value="">—</option>
                      {stations.map(station => (
                        <option key={station.id} value={station.id}>{station.name}</option>
                      ))}
                    </select>
                    {cell && (
                      <div className="route-code">
                        <code>{cell.code}</code>
                        <button
                          type="button"
                          className="link-btn"
                          aria-label={`New code for ${team.name} level ${level}`}
                          disabled={disabled}
                          onClick={() => void run(() => setRouteCode(team.id, level), team, level, '')}
                        >
                          New code
                        </button>
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
