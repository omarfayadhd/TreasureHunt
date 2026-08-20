export type TeamStatus = 'playing' | 'eliminated' | 'winner' | 'finished'

export type Placed = {
  status: TeamStatus
  cleared_level: number
  out_at_level: number | null
  finished_at: string | null
  eliminated_at: string | null
}

/**
 * The opening race fits everyone; every later race drops the slowest team.
 * `alive` counts teams that have not been eliminated — winners and finishers
 * still hold the slot they took.
 */
export function slotsForLevel(level: number, alive: number): number {
  if (level <= 1) return alive
  return Math.max(alive - 1, 1)
}

export function isUnlocked(level: number, cleared: number): boolean {
  return level <= cleared + 1
}

/**
 * Levels and teams need not match, but mismatches change how the game ends.
 * Returns null when the setup produces the intended single winner.
 */
export function setupWarning(levels: number, teams: number): string | null {
  if (levels === 0 || teams === 0) return null
  if (levels === teams) return null
  if (levels < teams) {
    const finishers = teams - levels + 1
    return `Only ${levels} clues for ${teams} teams — ${finishers} teams will claim the treasure together, placed by finish time.`
  }
  if (levels > teams) {
    return `${levels} clues for ${teams} teams — the hunt will end at clue ${teams} with one team standing, so the later clues go unused.`
  }
  return null
}

const rank: Record<TeamStatus, number> = { playing: 0, winner: 1, finished: 1, eliminated: 2 }

/** Sort comparator: best-placed team first. */
export function comparePlacement(a: Placed, b: Placed): number {
  if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
  if (a.status === 'playing') return b.cleared_level - a.cleared_level
  if (a.finished_at && b.finished_at) return a.finished_at.localeCompare(b.finished_at)
  const levelGap = (b.out_at_level ?? 0) - (a.out_at_level ?? 0)
  if (levelGap !== 0) return levelGap
  return (b.eliminated_at ?? '').localeCompare(a.eliminated_at ?? '')
}
