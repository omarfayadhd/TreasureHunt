import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { endGame, fetchGame, pauseGame, resetProgress, resumeGame, startGame, type AdminRpcResult, type GameRow } from './adminApi'

function errorMessage(error?: string): string {
  switch (error) {
    case 'no_stations':
      return 'Add at least one clue level before starting.'
    case 'no_teams':
      return 'Add teams before starting.'
    case 'level_gap':
      return 'Levels must run 1, 2, 3… with no gaps. Fix the Stations page first.'
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
