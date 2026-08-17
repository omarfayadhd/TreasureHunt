import { useAdminBoard } from './useAdminBoard'
import { timeAgo } from './timeAgo'
import { ordinal } from '../lib/ordinal'
import type { BoardRow } from './adminApi'

function finishRank(rows: BoardRow[], target: BoardRow): number {
  return rows.filter(r => r.finished_at).findIndex(r => r.id === target.id) + 1
}

const RESULT_ICONS = { correct: '✅', wrong: '❌', already_used: '🔁' } as const

export default function LiveBoard() {
  const { rows, attempts, error } = useAdminBoard()

  return (
    <div className="board-layout">
      <section className="card">
        <h2>Live board</h2>
        {error && <p className="msg msg-bad" role="alert">{error}</p>}
        <table className="board-table">
          <thead>
            <tr>
              <th>#</th><th>Team</th><th>Progress</th><th>Next station</th><th>Last solve</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className={row.finished_at ? 'row-finished' : ''}>
                <td>{index + 1}</td>
                <td>{row.name}</td>
                <td>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: row.total ? `${(row.current_position / row.total) * 100}%` : '0%' }}
                    />
                  </div>
                  {row.current_position}/{row.total}
                </td>
                <td>{row.finished_at ? '—' : row.next_station ?? 'no route'}</td>
                <td>{row.last_solve_at ? timeAgo(row.last_solve_at) : '—'}</td>
                <td>{row.finished_at ? `🏆 Finished ${ordinal(finishRank(rows, row))}` : 'Hunting'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No teams yet — add some in the Teams tab.</p>}
      </section>
      <aside className="card">
        <h2>Latest guesses</h2>
        <ul className="attempt-feed">
          {attempts.map(attempt => (
            <li key={attempt.id} className={`attempt-${attempt.result}`}>
              <span>{RESULT_ICONS[attempt.result]}</span>
              <strong>{attempt.teams?.name ?? '?'}</strong> tried <code>{attempt.submitted_code}</code>
              <time>{timeAgo(attempt.created_at)}</time>
            </li>
          ))}
          {attempts.length === 0 && <li className="empty">No guesses yet.</li>}
        </ul>
      </aside>
    </div>
  )
}
