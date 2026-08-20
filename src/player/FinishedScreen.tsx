import type { TeamView } from '../lib/api'
import { ChestSprite } from './sprites'
import Celebration from './Celebration'

/**
 * There is one treasure and one winner, so there is nothing to rank: no team
 * ever sees a placing. A team that arrives after the treasure is gone never
 * reaches this screen at all — it is told so on the code form instead.
 */
export default function FinishedScreen({ view }: { view: TeamView }) {
  const demo = view.demo_won && view.status !== 'winner'
  return (
    <div className="player-screen center-screen treasure">
      <Celebration />
      <ChestSprite className="sprite sprite-xl" />
      <h1 className="win-title">TREASURE FOUND!</h1>
      <p className="rank-line">
        {demo ? `${view.team_name} — demo run complete` : `${view.team_name} got there first!`}
      </p>
      <p>
        {demo
          ? 'This is the demo team, so the treasure is still out there for the real hunt.'
          : 'Head back to the game master to celebrate.'}
      </p>
    </div>
  )
}
