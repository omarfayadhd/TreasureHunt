import { supabase } from '../lib/supabaseClient'
import { generateCode } from '../lib/codes'

export type BoardRow = {
  id: string
  name: string
  team_code: string
  current_position: number
  finished_at: string | null
  created_at: string
  total: number
  next_station: string | null
  last_solve_at: string | null
}

export async function fetchBoard(): Promise<BoardRow[]> {
  const { data, error } = await supabase.from('admin_board').select('*')
  if (error) throw error
  return data as BoardRow[]
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

export function setTeamPosition(teamId: string, position: number): Promise<AdminRpcResult> {
  return adminRpc('set_team_position', { p_team_id: teamId, p_position: position })
}
