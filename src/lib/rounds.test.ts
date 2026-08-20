import { isUnlocked, comparePlacement, type Placed } from './rounds'

describe('isUnlocked', () => {
  it('unlocks the first card and one past what is cleared', () => {
    expect(isUnlocked(1, 0)).toBe(true)
    expect(isUnlocked(2, 0)).toBe(false)
    expect(isUnlocked(3, 2)).toBe(true)
    expect(isUnlocked(4, 2)).toBe(false)
  })
})

describe('comparePlacement', () => {
  const playing: Placed = { status: 'playing', cleared_level: 1, finished_at: null }

  it('ranks finishers ahead of teams still playing', () => {
    const done: Placed = { status: 'finished', cleared_level: 5, finished_at: '2026-08-20T10:06:00Z' }
    expect(comparePlacement(done, playing)).toBeLessThan(0)
  })

  it('orders finishers by finish time, earliest first', () => {
    const first: Placed = { status: 'winner', cleared_level: 5, finished_at: '2026-08-20T10:05:00Z' }
    const second: Placed = { status: 'finished', cleared_level: 5, finished_at: '2026-08-20T10:06:00Z' }
    expect([second, first].sort(comparePlacement)).toEqual([first, second])
  })

  it('orders teams still playing by how far they have cleared', () => {
    const ahead: Placed = { status: 'playing', cleared_level: 3, finished_at: null }
    expect(comparePlacement(ahead, playing)).toBeLessThan(0)
  })

  it('treats winner and finished as the same rank, separated only by time', () => {
    const winner: Placed = { status: 'winner', cleared_level: 5, finished_at: '2026-08-20T10:05:00Z' }
    const later: Placed = { status: 'finished', cleared_level: 5, finished_at: '2026-08-20T10:07:00Z' }
    expect(comparePlacement(winner, later)).toBeLessThan(0)
    expect(comparePlacement(later, winner)).toBeGreaterThan(0)
  })
})
