import { supabase } from '../lib/supabaseClient'

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
