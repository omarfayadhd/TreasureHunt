import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { endGame, fetchGame, pauseGame, resetProgress, resumeGame, startGame, type AdminRpcResult, type GameRow } from './adminApi'

// Every one of these is reachable from a stale tab or a double-click: the button
// is drawn from a game row that may already have moved on.
function errorMessage(error?: string): string {
  switch (error) {
    case 'no_stations':
      return 'Add at least one location before starting.'
    case 'no_teams':
      return 'Add teams before starting.'
    case 'not_enough_locations':
      return 'Add more locations: teams cannot be kept apart with fewer locations than teams.'
    case 'route_incomplete':
      return 'A team has an incomplete route. Fill every cell of the Team routes grid, from level 1 up.'
    case 'route_length_mismatch':
      return 'Every team must run the same number of levels. Even up the Team routes grid.'
    case 'no_treasure':
      return 'Set the treasure location and its code on the Stations page before starting.'
    case 'treasure_in_route':
      return 'The treasure sits on a team route. Move it, or re-route that team — teams may only meet there at the end.'
    case 'not_in_setup':
      return 'The hunt has already started — this page is just out of date. Refreshing now.'
    case 'not_live':
      return 'The hunt is not running, so there is nothing to pause. Refreshing now.'
    case 'not_paused':
      return 'The hunt is not paused, so there is nothing to resume. Refreshing now.'
    case 'not_running':
      return 'The hunt is not running, so there is nothing to end. Refreshing now.'
    default:
      return `Error: ${error}`
  }
}

export default function GameControl() {
  const [game, setGame] = useState<GameRow | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [resetText, setResetText] = useState('')

  const load = useCallback(async () => {
    const gameRow = await fetchGame()
    setGame(gameRow)
  }, [])

  useEffect(() => {
    load().catch(e => setMessage(e instanceof Error ? e.message : String(e)))
  }, [load])

  async function run(action: () => Promise<AdminRpcResult>) {
    setMessage(null)
    try {
      const result = await action()
      if (result.ok) {
        if (typeof result.teams === 'number' && typeof result.levels === 'number') {
          setMessage(`Live · ${result.teams} teams · ${result.levels} clues`)
        }
      } else {
        setMessage(errorMessage(result.error))
      }
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
        <h2>Danger zone</h2>
        <label htmlFor="reset-confirm">Type RESET to clear all progress (teams and stations are kept):</label>
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
