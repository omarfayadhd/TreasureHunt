import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createStation, deleteStation, fetchGame, fetchMonitor, fetchRoutes, fetchStations, refusal,
  swapOrder, updateStation, type RouteCell, type StationRow,
} from './adminApi'
import RouteGrid, { type RouteTeam } from './RouteGrid'

type Draft = { name: string; clue_text: string }

const RUNNING_HINT = 'Locations and routes are locked while the hunt is running'

function refusalMessage(error: string): string {
  switch (error) {
    case 'game_running':
      return 'The hunt is running — end it or reset progress before changing locations.'
    case 'not_found':
      return 'That location is no longer there — the list has been refreshed.'
    default:
      return `Error: ${error}`
  }
}

export default function StationsPanel() {
  const [stations, setStations] = useState<StationRow[]>([])
  const [teams, setTeams] = useState<RouteTeam[]>([])
  const [routes, setRoutes] = useState<RouteCell[]>([])
  const [gameRunning, setGameRunning] = useState(false)
  const [name, setName] = useState('')
  const [clue, setClue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', clue_text: '' })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [stationRows, game, monitor, routeRows] = await Promise.all([
      fetchStations(), fetchGame(), fetchMonitor(), fetchRoutes(),
    ])
    setStations(stationRows)
    setGameRunning(game.status === 'live' || game.status === 'paused')
    setTeams(monitor.map(team => ({ id: team.id, name: team.name })))
    setRoutes(routeRows)
  }, [])

  useEffect(() => {
    load().catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      const refused = refusal(await action())
      if (refused) setError(refusalMessage(refused))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (gameRunning) return
    if (!name.trim() || !clue.trim()) return
    setError(null)
    const nextOrder = stations.length ? Math.max(...stations.map(s => s.sort_order)) + 1 : 1
    run(() =>
      createStation({ name: name.trim(), clue_text: clue.trim(), sort_order: nextOrder }),
    )
    setName('')
    setClue('')
  }

  function startEdit(station: StationRow) {
    setEditingId(station.id)
    setDraft({ name: station.name, clue_text: station.clue_text })
  }

  function saveEdit(id: string) {
    if (gameRunning) return
    setError(null)
    run(() => updateStation(id, { name: draft.name.trim(), clue_text: draft.clue_text.trim() }))
    setEditingId(null)
  }

  return (
    <section className="card">
      <h2>Locations</h2>
      {gameRunning && (
        <p className="msg msg-warn">
          The hunt is live — locations and routes are locked. Adding a location would move the finish
          line mid-game, and re-routing a team would turn a posted paper code into a wrong answer. End
          the hunt or reset progress first.
        </p>
      )}
      <p className="hint">
        A location is just a place with a clue. Which team goes there, at which level, and with which
        code is set in the team routes below.
      </p>
      <form onSubmit={handleCreate} className="inline-form">
        <div>
          <label htmlFor="station-name">Location name</label>
          <input id="station-name" value={name} disabled={gameRunning} onChange={e => setName(e.target.value)} placeholder="Kitchen fridge" />
        </div>
        <div>
          <label htmlFor="station-clue">Clue leading here</label>
          <input id="station-clue" value={clue} disabled={gameRunning} onChange={e => setClue(e.target.value)} placeholder="Where lunches chill…" />
        </div>
        <button type="submit" disabled={gameRunning} title={gameRunning ? RUNNING_HINT : undefined}>
          Add location
        </button>
      </form>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      <table className="board-table">
        <thead>
          <tr><th>Order</th><th>Location</th><th>Clue</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {stations.map((station, index) => (
            <tr key={station.id}>
              <td>
                {station.sort_order}{' '}
                <button
                  className="link-btn"
                  disabled={index === 0 || gameRunning}
                  title={gameRunning ? RUNNING_HINT : undefined}
                  onClick={() => run(() => swapOrder(station, stations[index - 1]))}
                >
                  ↑
                </button>
                <button
                  className="link-btn"
                  disabled={index === stations.length - 1 || gameRunning}
                  title={gameRunning ? RUNNING_HINT : undefined}
                  onClick={() => run(() => swapOrder(station, stations[index + 1]))}
                >
                  ↓
                </button>
              </td>
              {editingId === station.id ? (
                <>
                  <td><input aria-label="Edit name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></td>
                  <td><input aria-label="Edit clue" value={draft.clue_text} onChange={e => setDraft({ ...draft, clue_text: e.target.value })} /></td>
                  <td>
                    <button onClick={() => saveEdit(station.id)}>Save</button>{' '}
                    <button className="link-btn" onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{station.name}</td>
                  <td>{station.clue_text}</td>
                  <td>
                    <button
                      className="link-btn"
                      disabled={gameRunning}
                      title={gameRunning ? RUNNING_HINT : undefined}
                      onClick={() => startEdit(station)}
                    >
                      Edit
                    </button>
                    <button
                      className="danger"
                      disabled={gameRunning}
                      title={RUNNING_HINT}
                      onClick={() => {
                        if (confirm(`Delete location "${station.name}"? Any team routed through it loses that stop.`)) {
                          run(() => deleteStation(station.id))
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {stations.length === 0 && <p className="empty">No locations yet — add the places of your hunt.</p>}

      <h2>Team routes</h2>
      <p className="hint">
        Each team walks its own route, and each cell has its own code: a code copied from another
        team is refused. No two teams share a location at the same level.
      </p>
      <RouteGrid
        teams={teams}
        stations={stations}
        rows={routes}
        disabled={gameRunning}
        onReload={() => void load()}
      />
    </section>
  )
}
