import type { Race } from '../lib/api'

export default function RaceStatus({ race }: { race: Race }) {
  const left = Math.max(race.slots - race.taken, 0)
  const urgent = left <= 1
  return (
    <div className="race-status" role="status">
      <span className="race-count">
        {race.taken} of {race.slots} codes found
      </span>
      <span className={urgent ? 'race-left race-urgent' : 'race-left'}>
        {left === 0 ? 'slots gone!' : `${left} slot${left === 1 ? '' : 's'} left`}
      </span>
    </div>
  )
}
