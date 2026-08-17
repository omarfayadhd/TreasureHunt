import { timeAgo } from './timeAgo'

describe('timeAgo', () => {
  const now = new Date('2026-08-17T12:00:00Z').getTime()

  it('formats seconds, minutes and hours', () => {
    expect(timeAgo('2026-08-17T11:59:18Z', now)).toBe('42s ago')
    expect(timeAgo('2026-08-17T11:55:00Z', now)).toBe('5m ago')
    expect(timeAgo('2026-08-17T10:00:00Z', now)).toBe('2h ago')
  })

  it('never goes negative', () => {
    expect(timeAgo('2026-08-17T12:00:05Z', now)).toBe('0s ago')
  })
})
