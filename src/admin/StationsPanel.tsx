import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createStation, deleteStation, fetchGame, fetchStations, makeFinal, swapOrder, updateStation,
  type StationRow,
} from './adminApi'
import { generateCode } from '../lib/codes'

type Draft = { name: string; clue_text: string; code: string }

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
    load()
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !clue.trim() || !code.trim()) return
    const nextOrder = stations.length ? Math.max(...stations.map(s => s.sort_order)) + 1 : 1
    run(() =>
      createStation({
        name: name.trim(),
        clue_text: clue.trim(),
        code: code.trim().toUpperCase(),
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
    run(() =>
      updateStation(id, {
        name: draft.name.trim(),
        clue_text: draft.clue_text.trim(),
        code: draft.code.trim().toUpperCase(),
      }),
    )
    setEditingId(null)
  }

  return (
    <section className="card">
      <h2>Stations</h2>
      {gameRunning && (
        <p className="msg msg-warn">The hunt is live — editing stations now can confuse teams mid-route.</p>
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
          <tr><th>Order</th><th>Station</th><th>Clue</th><th>Code</th><th>Final?</th><th>Actions</th></tr>
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
                  <td>{station.is_final ? '🏆 Final' : ''}</td>
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
                    <label style={{ display: 'inline', fontWeight: 400 }}>
                      <input
                        type="radio"
                        name="final-station"
                        checked={station.is_final}
                        onChange={() => run(() => makeFinal(station.id))}
                      />{' '}
                      {station.is_final ? '🏆 Final' : 'Set final'}
                    </label>
                  </td>
                  <td>
                    <button className="link-btn" onClick={() => startEdit(station)}>Edit</button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`Delete station "${station.name}"? Team routes that include it must be regenerated.`)) {
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
