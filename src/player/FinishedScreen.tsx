import type { TeamView } from '../lib/api'
import { ordinal } from '../lib/ordinal'
import { ChestSprite } from './sprites'

export default function FinishedScreen({ view }: { view: TeamView }) {
  const won = view.status === 'winner'
  return (
    <div className="player-screen center-screen treasure">
      <ChestSprite className="sprite sprite-xl" />
      <h1>{won ? 'TREASURE FOUND!' : 'TREASURE CLAIMED'}</h1>
      <p className="rank-line">
        {view.team_name} finished{view.place !== null ? ` ${ordinal(view.place)}` : ''}!
      </p>
      <p>Head back to the game master to celebrate.</p>
    </div>
  )
}
