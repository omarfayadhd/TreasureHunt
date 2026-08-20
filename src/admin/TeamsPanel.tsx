import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createTeam, deleteTeam, fetchMonitor, generateTeams, regenerateTeamCode, updateTeamName,
  type MonitorRow,
} from './adminApi'
import { comparePlacement } from '../lib/rounds'

export default function TeamsPanel() {
  const [teams, setTeams] = useState<MonitorRow[]>([])
  const [name, setName] = useState('')
  const [count, setCount] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setTeams([...(await fetchMonitor())].sort(comparePlacement))
  }, [])

  useEffect(() => {
    load().catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean; error?: string }).ok === false) {
        setError(`Error: ${(result as { error?: string }).error}`)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    run(() => createTeam(name.trim()))
    setName('')
  }

  function handleRename(team: MonitorRow) {
    const newName = prompt('New team name', team.name)
    if (newName && newName.trim() && newName !== team.name) {
      run(() => updateTeamName(team.id, newName.trim()))
    }
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault()
    const parsed = Number(count)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      setNote('Enter a whole number of teams between 1 and 50.')
      return
    }
    const result = await generateTeams(parsed)
    if (!result.ok) {
      setNote(result.error === 'game_live'
        ? 'End or reset the game first — teams are locked while it runs.'
        : 'That team count looks off. Try a number between 1 and 50.')
      return
    }
    setNote(`Added ${result.created} teams — ${result.total} in total.`)
    await load()
  }

  return (
    <section className="card">
      <h2>Teams</h2>
      <form onSubmit={handleGenerate} className="inline-form" noValidate>
        <div>
          <label htmlFor="team-count">Number of teams</label>
          <input
            id="team-count"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={e => setCount(e.target.value)}
          />
        </div>
        <button type="submit">Generate teams</button>
      </form>
      {note && <p className="msg msg-warn">{note}</p>}
      <form onSubmit={handleCreate} className="inline-form">
        <div>
          <label htmlFor="new-team-name">New team name</label>
          <input
            id="new-team-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="The Mongooses"
          />
        </div>
        <button type="submit">Add team</button>
      </form>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      <table className="board-table">
        <thead>
          <tr><th>Team</th><th>Team code</th><th>Progress</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {teams.map(team => (
            <tr key={team.id}>
              <td>
                {team.name}{' '}
                <button className="link-btn" onClick={() => handleRename(team)}>Rename</button>
              </td>
              <td>
                <code>{team.team_code}</code>{' '}
                <button className="link-btn" onClick={() => navigator.clipboard.writeText(team.team_code)}>Copy</button>
                <button className="link-btn" onClick={() => run(() => regenerateTeamCode(team.id))}>New code</button>
              </td>
              <td>
                {team.cleared_level}
                {(team.status === 'winner' || team.status === 'finished') ? ' 🏆' : ''}
              </td>
              <td>
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(`Delete team "${team.name}"?`)) run(() => deleteTeam(team.id))
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {teams.length === 0 && <p className="empty">No teams yet.</p>}
    </section>
  )
}
