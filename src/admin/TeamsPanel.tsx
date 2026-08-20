import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createTeam, deleteTeam, fetchGame, fetchMonitor, generateTeams, refusal, regenerateTeamCode,
  resetDemoTeam, setDemoTeam, updateTeamName, type AdminRpcResult, type MonitorRow,
} from './adminApi'
import { comparePlacement } from '../lib/rounds'

const RUNNING_HINT = 'Teams are locked while the hunt is running'

function refusalMessage(error: string): string {
  switch (error) {
    case 'game_live':
    case 'game_running':
      return 'End or reset the game first — teams are locked while it runs.'
    case 'bad_count':
      return 'That team count looks off. Try a number between 1 and 50.'
    case 'bad_name':
      return 'Give the team a name first.'
    case 'name_taken':
      return 'Another team already has that name.'
    case 'not_found':
      return 'That team is no longer there — the list has been refreshed.'
    default:
      return `Error: ${error}`
  }
}

export default function TeamsPanel() {
  const [teams, setTeams] = useState<MonitorRow[]>([])
  const [gameRunning, setGameRunning] = useState(false)
  const [name, setName] = useState('')
  const [count, setCount] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [rows, game] = await Promise.all([fetchMonitor(), fetchGame()])
    setTeams([...rows].sort(comparePlacement))
    setGameRunning(game.status === 'live' || game.status === 'paused')
  }, [])

  useEffect(() => {
    load().catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [load])

  /** Returns the result on success, null when the action threw or was refused. */
  async function run(action: () => Promise<unknown>): Promise<unknown> {
    setError(null)
    try {
      const result = await action()
      const refused = refusal(result)
      if (refused) setError(refusalMessage(refused))
      await load()
      return refused ? null : result
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (gameRunning || !name.trim()) return
    run(() => createTeam(name.trim()))
    setName('')
  }

  function handleRename(team: MonitorRow) {
    if (gameRunning) return
    const newName = prompt('New team name', team.name)
    if (newName && newName.trim() && newName !== team.name) {
      run(() => updateTeamName(team.id, newName.trim()))
    }
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault()
    setNote(null)
    const parsed = Number(count)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      setNote('Enter a whole number of teams between 1 and 50.')
      return
    }
    // Routed through run() so a thrown error surfaces too — this used to be the
    // one action that could fail with no message at all.
    const result = (await run(() => generateTeams(parsed))) as AdminRpcResult | null
    if (result?.ok) setNote(`Added ${result.created} teams — ${result.total} in total.`)
  }

  return (
    <section className="card">
      <h2>Teams</h2>
      {gameRunning && (
        <p className="msg msg-warn">
          The hunt is live — teams are locked. A new code would invalidate a printed slip and drop
          that team at the login screen, and deleting a team would erase its progress. End the hunt
          or reset progress first.
        </p>
      )}
      <form onSubmit={handleGenerate} className="inline-form" noValidate>
        <div>
          <label htmlFor="team-count">Number of teams</label>
          <input
            id="team-count"
            type="number"
            min={1}
            max={50}
            value={count}
            disabled={gameRunning}
            onChange={e => setCount(e.target.value)}
          />
        </div>
        <button type="submit" disabled={gameRunning} title={gameRunning ? RUNNING_HINT : undefined}>
          Generate teams
        </button>
      </form>
      {note && <p className="msg msg-warn">{note}</p>}
      <form onSubmit={handleCreate} className="inline-form">
        <div>
          <label htmlFor="new-team-name">New team name</label>
          <input
            id="new-team-name"
            value={name}
            disabled={gameRunning}
            onChange={e => setName(e.target.value)}
            placeholder="The Mongooses"
          />
        </div>
        <button type="submit" disabled={gameRunning} title={gameRunning ? RUNNING_HINT : undefined}>
          Add team
        </button>
      </form>
      {error && <p className="msg msg-bad" role="alert">{error}</p>}
      <table className="board-table">
        <thead>
          <tr><th>Team</th><th>Team code</th><th>Progress</th><th>Demo</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {teams.map(team => (
            <tr key={team.id}>
              <td>
                {team.name}{' '}
                <button
                  className="link-btn"
                  disabled={gameRunning}
                  title={gameRunning ? RUNNING_HINT : undefined}
                  onClick={() => handleRename(team)}
                >
                  Rename
                </button>
              </td>
              <td>
                <code>{team.team_code}</code>{' '}
                <button className="link-btn" onClick={() => navigator.clipboard.writeText(team.team_code)}>Copy</button>
                <button
                  className="link-btn"
                  disabled={gameRunning}
                  title={gameRunning ? RUNNING_HINT : undefined}
                  onClick={() => run(() => regenerateTeamCode(team.id))}
                >
                  New code
                </button>
              </td>
              <td>
                {team.cleared_level}
                {(team.status === 'winner' || team.status === 'finished') ? ' 🏆' : ''}
              </td>
              <td>
                {team.is_demo ? (
                  <>
                    <span className="demo-badge">DEMO</span>{' '}
                    {/* Never disabled by a running hunt: replaying the demo for a
                        colleague mid-game touches nothing real. */}
                    <button className="link-btn" onClick={() => run(() => resetDemoTeam())}>
                      Reset demo run
                    </button>
                    {team.demo_won_at && <span className="hint"> · reached the treasure</span>}
                  </>
                ) : (
                  <button
                    className="link-btn"
                    aria-label={`Make ${team.name} the demo team`}
                    onClick={() => run(() => setDemoTeam(team.id, true))}
                  >
                    Make demo
                  </button>
                )}
              </td>
              <td>
                <button
                  className="danger"
                  disabled={gameRunning}
                  title={gameRunning ? RUNNING_HINT : undefined}
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
