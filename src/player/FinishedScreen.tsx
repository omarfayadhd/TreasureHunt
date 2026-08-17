import type { TeamView } from '../lib/api'
import { ordinal } from '../lib/ordinal'

export default function FinishedScreen({ view }: { view: TeamView }) {
  return (
    <div className="player-screen center-screen treasure">
      <div className="big-emoji">🏆</div>
      <h1>TREASURE FOUND!</h1>
      <p className="rank-line">
        {view.team_name} finished {view.rank !== null ? ordinal(view.rank) : ''}!
      </p>
      <p>Head back to the game master to celebrate.</p>
    </div>
  )
}
