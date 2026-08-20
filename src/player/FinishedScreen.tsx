import type { TeamView } from '../lib/api'
import { ChestSprite } from './sprites'

/**
 * There is one treasure and one winner, so there is nothing to rank: no team
 * ever sees a placing. A team that arrives after the treasure is gone never
 * reaches this screen at all — it is told so on the code form instead.
 */
export default function FinishedScreen({ view }: { view: TeamView }) {
  return (
    <div className="player-screen center-screen treasure">
      <ChestSprite className="sprite sprite-xl" />
      <h1>TREASURE FOUND!</h1>
      <p className="rank-line">{view.team_name} got there first!</p>
      <p>Head back to the game master to celebrate.</p>
    </div>
  )
}
