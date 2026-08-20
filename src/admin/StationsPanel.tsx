import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createStation, deleteStation, fetchGame, fetchStations, refusal, swapOrder, updateStation,
  type StationRow,
} from './adminApi'
import { generateCode } from '../lib/codes'

type Draft = { name: string; clue_text: string; code: string }

const CODE = /^[A-Z0-9]{3,12}$/

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase()
}

function refusalMessage(error: string): string {
  switch (error) {
    case 'game_running':
      return 'The hunt is running — end it or reset progress before changing the level ladder.'
    case 'not_found':
      return 'That station is no longer there — the list has been refreshed.'
    default:
      return `Error: ${error}`
  }
}

export default function StationsPanel() {
  const [stations, setStations] = useState<StationRow[]>([])
  const [gameRunning, setGameRunning] = useState(false)
  const [name, setName] = useState('')
  const [clue, setClue] = useState('')
  const [code, setCode] = useState(() => generateCode())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', clue_text: '', code: '' })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [stationRows, game] = await Promise.all([fetchStations(), fetchGame()])
    setStations(stationRows)
    setGameRunning(game.status === 'live' || game.status === 'paused')
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
    if (!name.trim() || !clue.trim() || !code.trim()) return
    const normalizedCode = normalizeCode(code)
    if (!CODE.test(normalizedCode)) {
      setError('Codes are letters and numbers only, 3–12 characters.')
      return
    }
    setError(null)
    const nextOrder = stations.length ? Math.max(...stations.map(s => s.sort_order)) + 1 : 1
    run(() =>
      createStation({
        name: name.trim(),
        clue_text: clue.trim(),
        code: normalizedCode,
        sort_order: nextOrder,
      }),
    )
    setName('')
    setClue('')
    setCode(generateCode())
  }

  function startEdit(station: StationRow) {
    setEditingId(station.id)
    setDraft({ name: station.name, clue_text: station.clue_text, code: station.code })
  }

  function saveEdit(id: string) {
    const normalizedCode = normalizeCode(draft.code)
    if (!CODE.test(normalizedCode)) {
      setError('Codes are letters and numbers only, 3–12 characters.')
      return
    }
    setError(null)
    run(() =>
      updateStation(id, {
        name: draft.name.trim(),
        clue_text: draft.clue_text.trim(),
        code: normalizedCode,
      }),
    )
    setEditingId(null)
  }

  const levels = stations.map(s => s.sort_order)
  const minLevel = levels.length ? Math.min(...levels) : 1
  const maxLevel = levels.length ? Math.max(...levels) : 0
  const hasGap = stations.length > 0 && (minLevel !== 1 || maxLevel !== stations.length)

  return (
    <section className="card">
      <h2>Stations</h2>
      {gameRunning && (
        <p className="msg msg-warn">The hunt is live — editing stations now can confuse teams mid-route.</p>
      )}
      {hasGap && (
        <p className="msg msg-warn">Levels must run 1 to {stations.length} with no gaps.</p>
      )}
      <form onSubmit={handleCreate} className="inline-form">
        <div>
          <label htmlFor="station-name">Station name</label>
          <input id="station-name" value={name} onChange={e => setName(e.target.value)} placeholder="Kitchen fridge" />
        </div>
        <div>
          <label htmlFor="station-clue">Clue leading here</label>
          <input id="station-clue" value={clue} onChange={e => setClue(e.target.value)} placeholder="Where lunches chill…" />
        </div>
        <div>
          <label htmlFor="station-code">Code</label>
          <input id="station-code" value={code} onChange={e => setCode(e.target.value)} />
        </div>
        <button type="submit">Add station</button>
      </form>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      <table className="board-table">
        <thead>
          <tr><th>Level</th><th>Station</th><th>Clue</th><th>Code</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {stations.map((station, index) => (
            <tr key={station.id}>
              <td>
                {station.sort_order}{' '}
                <button
                  className="link-btn"
                  disabled={index === 0}
                  onClick={() => run(() => swapOrder(station, stations[index - 1]))}
                >
                  ↑
                </button>
                <button
                  className="link-btn"
                  disabled={index === stations.length - 1}
                  onClick={() => run(() => swapOrder(station, stations[index + 1]))}
                >
                  ↓
                </button>
              </td>
              {editingId === station.id ? (
                <>
                  <td><input aria-label="Edit name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></td>
                  <td><input aria-label="Edit clue" value={draft.clue_text} onChange={e => setDraft({ ...draft, clue_text: e.target.value })} /></td>
                  <td><input aria-label="Edit code" value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} /></td>
                  <td>
                    <button onClick={() => saveEdit(station.id)}>Save</button>{' '}
                    <button className="link-btn" onClick={() => setEditingId(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{station.name}</td>
                  <td>{station.clue_text}</td>
                  <td><code>{station.code}</code></td>
                  <td>
                    <button className="link-btn" onClick={() => startEdit(station)}>Edit</button>
                    <button
                      className="danger"
                      disabled={gameRunning}
                      title="Stations can't be deleted while the hunt is running"
                      onClick={() => {
                        if (confirm(`Delete station "${station.name}"? This changes the shared level ladder for every team.`)) {
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
      {stations.length === 0 && <p className="empty">No stations yet — add the locations of your hunt.</p>}
    </section>
  )
}
