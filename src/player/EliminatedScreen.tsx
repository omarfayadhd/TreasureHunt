import type { TeamView } from '../lib/api'
import { ordinal } from '../lib/ordinal'
import { GhostSprite } from './sprites'

export default function EliminatedScreen({ view }: { view: TeamView }) {
  return (
    <div className="player-screen center-screen eliminated">
      <GhostSprite className="sprite sprite-xl" />
      <h1>GAME OVER</h1>
      <p className="eliminated-why">
        You're out of the competition — the other teams found all the codes first.
      </p>
      <p className="rank-line">
        You reached clue {view.out_at_level ?? view.cleared + 1} of {view.total}
        {view.place !== null ? ` · ${ordinal(view.place)} place` : ''}
      </p>
    </div>
  )
}
