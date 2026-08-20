import type { Race } from '../lib/api'

export default function RaceStatus({ race }: { race: Race }) {
  return (
    <div className="race-status" role="status">
      <span className="race-count">
        {race.found} of {race.teams} teams found this code
      </span>
    </div>
  )
}
