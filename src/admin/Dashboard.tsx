import { setupWarning, slotsForLevel } from '../lib/rounds'
import { timeAgo } from './timeAgo'
import { useMonitor } from './useMonitor'

export default function Dashboard() {
  const { rows, levels, game, error, loading } = useMonitor()

  const alive = rows.filter(r => r.status !== 'eliminated')
  const racing = rows.filter(r => r.status === 'playing')
  const raceLevel = racing.length ? Math.min(...racing.map(r => r.cleared_level)) + 1 : null
  const slots = raceLevel ? slotsForLevel(raceLevel, alive.length) : 0
  const taken = raceLevel ? rows.filter(r => r.cleared_level >= raceLevel).length : 0
  const warning = setupWarning(levels, rows.length)

  return (
    <section className="control-layout">
      <h1>Game dashboard</h1>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      {loading && <p className="hint">Loading…</p>}

      <div className="card hud">
        <p className="hud-line">
          <strong className={`status status-${game?.status ?? 'setup'}`}>{game?.status ?? 'setup'}</strong>
          {' · '}
          {racing.length} teams alive of {rows.length}
          {raceLevel !== null && ` · racing clue ${raceLevel}: ${taken} of ${slots} slots taken`}
        </p>
        <p className={warning ? 'msg msg-warn' : 'hint'}>
          {warning ?? `${levels} clues for ${rows.length} teams — set up to end on one winner.`}
        </p>
      </div>

      <div className="card">
        <table className="board-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Start</th>
              <th>Opened</th>
              <th>Cleared</th>
              <th>State</th>
              <th>Last code</th>
              <th>Misses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.id}
                className={
                  row.status === 'winner' ? 'row-winner'
                  : row.status === 'eliminated' ? 'row-out'
                  : !row.started ? 'row-idle'
                  : undefined
                }
              >
                <td>{row.name}</td>
                <td>{row.started ? 'Started' : 'Not started'}</td>
                <td>{row.max_opened_level ?? '—'}</td>
                <td>{row.cleared_level}</td>
                <td>
                  {row.status === 'eliminated'
                    ? `Out at ${row.out_at_level}`
                    : row.status === 'winner'
                      ? 'Winner'
                      : row.status === 'finished'
                        ? 'Finished'
                        : 'Playing'}
                </td>
                <td>{row.last_solve_at ? timeAgo(row.last_solve_at) : '—'}</td>
                <td>{row.wrong_count}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={7} className="empty">No teams yet — add them on the Teams page.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
