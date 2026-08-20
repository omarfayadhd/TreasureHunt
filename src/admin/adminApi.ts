import { supabase } from '../lib/supabaseClient'
import type { TeamStatus } from '../lib/api'

export type MonitorRow = {
  id: string
  name: string
  team_code: string
  status: TeamStatus
  cleared_level: number
  out_at_level: number | null
  finished_at: string | null
  eliminated_at: string | null
  created_at: string
  started: boolean
  max_opened_level: number | null
  last_solve_at: string | null
  wrong_count: number
  /** The location this team is hunting right now; null once its route is done. */
  current_location: string | null
}

export async function fetchMonitor(): Promise<MonitorRow[]> {
  const { data, error } = await supabase.from('admin_monitor').select('*')
  if (error) throw error
  return data as MonitorRow[]
}

export async function countStations(): Promise<number> {
  const { count, error } = await supabase.from('stations').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

export type AdminRpcResult = { ok: boolean; error?: string; [key: string]: unknown }

async function adminRpc(fn: string, args?: Record<string, unknown>): Promise<AdminRpcResult> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as AdminRpcResult
}

/**
 * Admin RPCs report refusals as `{ ok: false, error }` rather than throwing.
 * Plain table writes resolve to `undefined`, so those always read as accepted.
 */
export function refusal(result: unknown): string | null {
  if (result && typeof result === 'object' && 'ok' in result && (result as AdminRpcResult).ok === false) {
    return (result as AdminRpcResult).error ?? 'unknown'
  }
  return null
}

// Team writes all go through admin RPCs: they check the game status server-side
// (so a stale tab can't eject a live team) and mint codes from the
// collision-checked server generator rather than a guessable browser word list.
export const createTeam = (name: string): Promise<AdminRpcResult> =>
  adminRpc('create_team', { p_name: name })

export const updateTeamName = (id: string, name: string): Promise<AdminRpcResult> =>
  adminRpc('rename_team', { p_team_id: id, p_name: name })

export const regenerateTeamCode = (id: string): Promise<AdminRpcResult> =>
  adminRpc('regenerate_team_code', { p_team_id: id })

export const deleteTeam = (id: string): Promise<AdminRpcResult> =>
  adminRpc('delete_team', { p_team_id: id })

export const generateTeams = (count: number): Promise<AdminRpcResult> =>
  adminRpc('generate_teams', { p_count: count })

/** A location: a place with a clue. Codes and levels live per team, in `team_stations`. */
export type StationRow = {
  id: string
  name: string
  clue_text: string
  sort_order: number
}

export async function fetchStations(): Promise<StationRow[]> {
  const { data, error } = await supabase
    .from('stations')
    .select('id, name, clue_text, sort_order')
    .order('sort_order')
  if (error) throw error
  return data as StationRow[]
}

export async function createStation(input: {
  name: string
  clue_text: string
  sort_order: number
}): Promise<void> {
  const { error } = await supabase.from('stations').insert(input)
  if (error) throw error
}

export async function updateStation(
  id: string,
  patch: Partial<Pick<StationRow, 'name' | 'clue_text' | 'sort_order'>>,
): Promise<void> {
  const { error } = await supabase.from('stations').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteStation(id: string): Promise<void> {
  const { error } = await supabase.from('stations').delete().eq('id', id)
  if (error) throw error
}

/**
 * `sort_order` is uniquely constrained, so two separate UPDATEs always collide
 * on the row still holding the target level. The swap happens server-side in
 * one transaction instead.
 */
export const swapOrder = (a: StationRow, b: StationRow): Promise<AdminRpcResult> =>
  adminRpc('swap_station_levels', { p_a: a.id, p_b: b.id })

export type GameRow = {
  id: number
  status: import('../lib/api').GameStatus
  started_at: string | null
  ended_at: string | null
  initial_team_count: number | null
}

export async function fetchGame(): Promise<GameRow> {
  const { data, error } = await supabase.from('game').select('*').single()
  if (error) throw error
  return data as GameRow
}

/** One cell of the teams x levels route grid: this team's stop at this level. */
export type RouteCell = { team_id: string; level: number; station_id: string; code: string }

export async function fetchRoutes(): Promise<RouteCell[]> {
  const { data, error } = await supabase
    .from('team_stations')
    .select('team_id, level, station_id, code')
    .order('level')
  if (error) throw error
  return data as RouteCell[]
}

// Route writes go through admin RPCs so the two staggering collisions come back
// as readable codes rather than raw constraint names, and so a stale tab cannot
// re-route a team mid-game.
export const setRouteCell = (
  teamId: string,
  level: number,
  stationId: string,
): Promise<AdminRpcResult> =>
  adminRpc('set_route_cell', { p_team_id: teamId, p_level: level, p_station_id: stationId })

export const setRouteCode = (teamId: string, level: number): Promise<AdminRpcResult> =>
  adminRpc('set_route_code', { p_team_id: teamId, p_level: level })

export const clearRouteCell = (teamId: string, level: number): Promise<AdminRpcResult> =>
  adminRpc('clear_route_cell', { p_team_id: teamId, p_level: level })

export const startGame = (): Promise<AdminRpcResult> => adminRpc('start_game')
export const pauseGame = (): Promise<AdminRpcResult> => adminRpc('pause_game')
export const resumeGame = (): Promise<AdminRpcResult> => adminRpc('resume_game')
export const endGame = (): Promise<AdminRpcResult> => adminRpc('end_game')
export const resetProgress = (): Promise<AdminRpcResult> => adminRpc('reset_progress')
