import { usePlayerGame } from './usePlayerGame'
import LoginScreen from './LoginScreen'
import GameScreen from './GameScreen'
import WaitingScreen from './WaitingScreen'
import FinishedScreen from './FinishedScreen'

export default function PlayerApp() {
  const game = usePlayerGame()

  if (game.restoring) return <div className="center-screen">Loading…</div>
  if (!game.view) return <LoginScreen onLogin={game.login} error={game.loginError} busy={game.busy} />

  const view = game.view
  if (view.finished) return <FinishedScreen view={view} />
  if (view.game_status !== 'live') return <WaitingScreen status={view.game_status} teamName={view.team_name} />
  return <GameScreen view={view} feedback={game.feedback} busy={game.busy} onSubmit={game.submit} />
}
