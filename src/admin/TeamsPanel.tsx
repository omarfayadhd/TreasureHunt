import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createTeam, deleteTeam, fetchBoard, regenerateTeamCode, setTeamPosition, updateTeamName,
  type BoardRow,
} from './adminApi'
import { sortBoard } from './sortBoard'

export default function TeamsPanel() {
  const [teams, setTeams] = useState<BoardRow[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setTeams(sortBoard(await fetchBoard()))
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

  function handleRename(team: BoardRow) {
    const newName = prompt('New team name', team.name)
    if (newName && newName.trim() && newName !== team.name) {
      run(() => updateTeamName(team.id, newName.trim()))
    }
  }

  return (
    <section className="card">
      <h2>Teams</h2>
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
              <td>{team.current_position}/{team.total}{team.finished_at ? ' 🏆' : ''}</td>
              <td>
                <button
                  onClick={() => run(() => setTeamPosition(team.id, team.current_position - 1))}
                  disabled={team.current_position <= 0}
                >
                  -1
                </button>{' '}
                <button
                  onClick={() => run(() => setTeamPosition(team.id, team.current_position + 1))}
                  disabled={team.total > 0 && team.current_position >= team.total}
                >
                  +1
                </button>{' '}
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
