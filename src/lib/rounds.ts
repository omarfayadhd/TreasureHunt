export type TeamStatus = 'playing' | 'eliminated' | 'winner' | 'finished'

export type Placed = {
  status: TeamStatus
  cleared_level: number
  finished_at: string | null
}

export function isUnlocked(level: number, cleared: number): boolean {
  return level <= cleared + 1
}

/** Finishers first (earliest finish wins), then teams still hunting by progress. */
export function comparePlacement(a: Placed, b: Placed): number {
  const aDone = a.finished_at !== null
  const bDone = b.finished_at !== null
  if (aDone !== bDone) return aDone ? -1 : 1
  if (aDone && bDone) return (a.finished_at as string).localeCompare(b.finished_at as string)
  return b.cleared_level - a.cleared_level
}
