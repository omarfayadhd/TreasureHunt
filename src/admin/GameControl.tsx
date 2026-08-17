import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  endGame, fetchGame, fetchRoutePreview, generateRoutes, pauseGame, resetProgress, resumeGame, startGame,
  type AdminRpcResult, type GameRow, type RoutePreview,
} from './adminApi'

export default function GameControl() {
  const [game, setGame] = useState<GameRow | null>(null)
  const [preview, setPreview] = useState<RoutePreview[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [resetText, setResetText] = useState('')

  const load = useCallback(async () => {
    const [gameRow, previewRows] = await Promise.all([fetchGame(), fetchRoutePreview()])
    setGame(gameRow)
    setPreview(previewRows)
  }, [])

  useEffect(() => {
    load().catch(e => setMessage(e instanceof Error ? e.message : String(e)))
  }, [load])

  async function run(action: () => Promise<AdminRpcResult>) {
    setMessage(null)
    try {
      const result = await action()
      if (!result.ok) setMessage(`Error: ${result.error}`)
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  if (!game) return message ? <p className="msg msg-bad" role="alert">{message}</p> : null

  return (
    <div className="control-layout">
      <section className="card">
        <h2>
          Game status: <span className={`status status-${game.status}`}>{game.status}</span>
        </h2>
        <div className="btn-row">
          {game.status === 'setup' && <button onClick={() => run(startGame)}>Start hunt</button>}
          {game.status === 'live' && <button onClick={() => run(pauseGame)}>Pause</button>}
          {game.status === 'paused' && <button onClick={() => run(resumeGame)}>Resume</button>}
          {(game.status === 'live' || game.status === 'paused') && (
            <button className="danger" onClick={() => run(endGame)}>End hunt</button>
          )}
        </div>
        {message && <p className="msg msg-bad" role="alert">{message}</p>}
      </section>

      <section className="card">
        <h2>Routes</h2>
        <button onClick={() => run(generateRoutes)}>Generate routes</button>
        <p className="hint">
          In setup this reshuffles every team's route. While the hunt is running it only creates routes for
          teams that don't have one yet.
        </p>
        <table className="board-table">
          <thead>
            <tr><th>Team</th><th>Route</th></tr>
          </thead>
          <tbody>
            {preview.map(route => (
              <tr key={route.team}>
                <td>{route.team}</td>
                <td>{route.stops.join(' → ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.length === 0 && <p className="empty">No routes yet.</p>}
      </section>

      <section className="card">
        <h2>Danger zone</h2>
        <label htmlFor="reset-confirm">Type RESET to clear all progress (teams, stations and routes are kept):</label>
        <input id="reset-confirm" value={resetText} onChange={e => setResetText(e.target.value)} />
        <div className="btn-row" style={{ marginTop: '0.6rem' }}>
          <button
            className="danger"
            disabled={resetText !== 'RESET'}
            onClick={() => {
              run(resetProgress)
              setResetText('')
            }}
          >
            Reset progress
          </button>
        </div>
        <p>
          <Link to="/admin/print">Open print sheets →</Link>
        </p>
      </section>
    </div>
  )
}
