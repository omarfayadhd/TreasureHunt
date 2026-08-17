import { sortBoard } from './sortBoard'
import type { BoardRow } from './adminApi'

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Team',
    team_code: 'X-00',
    current_position: 0,
    finished_at: null,
    created_at: '2026-08-17T09:00:00Z',
    total: 5,
    next_station: null,
    last_solve_at: null,
    ...overrides,
  }
}

describe('sortBoard', () => {
  it('puts finished teams first, ordered by finish time', () => {
    const rows = [
      row({ name: 'SecondFinisher', finished_at: '2026-08-17T10:05:00Z', current_position: 5 }),
      row({ name: 'Hunting', current_position: 3 }),
      row({ name: 'FirstFinisher', finished_at: '2026-08-17T10:01:00Z', current_position: 5 }),
    ]
    expect(sortBoard(rows).map(r => r.name)).toEqual(['FirstFinisher', 'SecondFinisher', 'Hunting'])
  })

  it('ranks unfinished teams by progress, then earliest last solve', () => {
    const rows = [
      row({ name: 'SlowAtThree', current_position: 3, last_solve_at: '2026-08-17T10:10:00Z' }),
      row({ name: 'FastAtThree', current_position: 3, last_solve_at: '2026-08-17T10:02:00Z' }),
      row({ name: 'AtFour', current_position: 4, last_solve_at: '2026-08-17T10:12:00Z' }),
      row({ name: 'NotStarted', current_position: 0 }),
    ]
    expect(sortBoard(rows).map(r => r.name)).toEqual(['AtFour', 'FastAtThree', 'SlowAtThree', 'NotStarted'])
  })

  it('breaks full ties alphabetically and does not mutate the input', () => {
    const rows = [row({ name: 'Zebra' }), row({ name: 'Apple' })]
    const sorted = sortBoard(rows)
    expect(sorted.map(r => r.name)).toEqual(['Apple', 'Zebra'])
    expect(rows.map(r => r.name)).toEqual(['Zebra', 'Apple'])
  })
})
