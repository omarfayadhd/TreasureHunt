import { slotsForLevel, isUnlocked, setupWarning, comparePlacement, type Placed } from './rounds'

describe('slotsForLevel', () => {
  it('fits every team in the opening race', () => {
    expect(slotsForLevel(1, 5)).toBe(5)
  })

  it('drops one team per later race', () => {
    expect(slotsForLevel(2, 5)).toBe(4)
    expect(slotsForLevel(3, 4)).toBe(3)
    expect(slotsForLevel(5, 2)).toBe(1)
  })

  it('never returns zero slots, so a solo game stays playable', () => {
    expect(slotsForLevel(4, 1)).toBe(1)
  })
})

describe('isUnlocked', () => {
  it('unlocks the first card and one past what is cleared', () => {
    expect(isUnlocked(1, 0)).toBe(true)
    expect(isUnlocked(2, 0)).toBe(false)
    expect(isUnlocked(3, 2)).toBe(true)
    expect(isUnlocked(4, 2)).toBe(false)
  })
})

describe('setupWarning', () => {
  it('is silent when levels match teams', () => {
    expect(setupWarning(5, 5)).toBeNull()
  })

  it('warns when there are too few levels to reach one winner', () => {
    expect(setupWarning(3, 5)).toMatch(/3 teams will claim the treasure together/i)
  })

  it('warns when spare levels will go unused', () => {
    expect(setupWarning(6, 3)).toMatch(/end at clue 3/i)
  })
})

describe('comparePlacement', () => {
  const base: Placed = {
    status: 'eliminated', cleared_level: 1, out_at_level: 2,
    finished_at: null, eliminated_at: '2026-08-20T10:00:00Z',
  }

  it('ranks finishers ahead of eliminated teams, earliest finish first', () => {
    const winner = { ...base, status: 'winner' as const, finished_at: '2026-08-20T10:05:00Z' }
    const second = { ...base, status: 'finished' as const, finished_at: '2026-08-20T10:06:00Z' }
    expect([base, second, winner].sort(comparePlacement).map(t => t.status))
      .toEqual(['winner', 'finished', 'eliminated'])
  })

  it('ranks a deeper elimination ahead of a shallower one', () => {
    const deep = { ...base, out_at_level: 4 }
    expect(comparePlacement(base, deep)).toBeGreaterThan(0)
  })

  it('ranks a later elimination ahead at the same level', () => {
    const later = { ...base, eliminated_at: '2026-08-20T10:09:00Z' }
    expect(comparePlacement(base, later)).toBeGreaterThan(0)
  })

  it('ranks teams still playing ahead of everyone out', () => {
    const playing = { ...base, status: 'playing' as const, cleared_level: 2, out_at_level: null }
    expect(comparePlacement(playing, base)).toBeLessThan(0)
  })
})
