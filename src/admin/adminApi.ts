import { supabase } from '../lib/supabaseClient'
import { generateCode } from '../lib/codes'
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

export type AttemptRow = {
  id: number
  submitted_code: string
  result: 'correct' | 'wrong' | 'already_used'
  created_at: string
  teams: { name: string } | null
}

export async function fetchRecentAttempts(limit = 20): Promise<AttemptRow[]> {
  const { data, error } = await supabase
    .from('attempts')
    .select('id, submitted_code, result, created_at, teams(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as unknown as AttemptRow[]
}

export type AdminRpcResult = { ok: boolean; error?: string; [key: string]: unknown }

async function adminRpc(fn: string, args?: Record<string, unknown>): Promise<AdminRpcResult> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as AdminRpcResult
}

export async function createTeam(name: string): Promise<void> {
  const { error } = await supabase.from('teams').insert({ name, team_code: generateCode() })
  if (error) throw error
}

export async function updateTeamName(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('teams').update({ name }).eq('id', id)
  if (error) throw error
}

export async function regenerateTeamCode(id: string): Promise<void> {
  const { error } = await supabase.from('teams').update({ team_code: generateCode() }).eq('id', id)
  if (error) throw error
}

export async function deleteTeam(id: string): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', id)
  if (error) throw error
}

export const generateTeams = (count: number): Promise<AdminRpcResult> =>
  adminRpc('generate_teams', { p_count: count })

export type StationRow = {
  id: string
  name: string
  clue_text: string
  code: string
  sort_order: number
}

export async function fetchStations(): Promise<StationRow[]> {
  const { data, error } = await supabase
    .from('stations')
    .select('id, name, clue_text, code, sort_order')
    .order('sort_order')
  if (error) throw error
  return data as StationRow[]
}

export async function createStation(input: {
  name: string
  clue_text: string
  code: string
  sort_order: number
}): Promise<void> {
  const { error } = await supabase.from('stations').insert(input)
  if (error) throw error
}

export async function updateStation(
  id: string,
  patch: Partial<Pick<StationRow, 'name' | 'clue_text' | 'code' | 'sort_order'>>,
): Promise<void> {
  const { error } = await supabase.from('stations').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteStation(id: string): Promise<void> {
  const { error } = await supabase.from('stations').delete().eq('id', id)
  if (error) throw error
}

export async function swapOrder(a: StationRow, b: StationRow): Promise<void> {
  const { error: firstError } = await supabase.from('stations').update({ sort_order: b.sort_order }).eq('id', a.id)
  if (firstError) throw firstError
  const { error: secondError } = await supabase.from('stations').update({ sort_order: a.sort_order }).eq('id', b.id)
  if (secondError) throw secondError
}

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

export const startGame = (): Promise<AdminRpcResult> => adminRpc('start_game')
export const pauseGame = (): Promise<AdminRpcResult> => adminRpc('pause_game')
export const resumeGame = (): Promise<AdminRpcResult> => adminRpc('resume_game')
export const endGame = (): Promise<AdminRpcResult> => adminRpc('end_game')
export const resetProgress = (): Promise<AdminRpcResult> => adminRpc('reset_progress')
