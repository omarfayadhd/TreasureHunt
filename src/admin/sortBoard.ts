import type { BoardRow } from './adminApi'

export function sortBoard(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => {
    if (a.finished_at && b.finished_at) return a.finished_at < b.finished_at ? -1 : 1
    if (a.finished_at) return -1
    if (b.finished_at) return 1
    if (a.current_position !== b.current_position) return b.current_position - a.current_position
    if (a.last_solve_at && b.last_solve_at && a.last_solve_at !== b.last_solve_at) {
      return a.last_solve_at < b.last_solve_at ? -1 : 1
    }
    if (a.last_solve_at && !b.last_solve_at) return -1
    if (!a.last_solve_at && b.last_solve_at) return 1
    return a.name.localeCompare(b.name)
  })
}
