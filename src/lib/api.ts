import { supabase } from './supabaseClient'

export type GameStatus = 'setup' | 'live' | 'paused' | 'ended'

export type TeamView = {
  ok: true
  team_name: string
  game_status: GameStatus
  position: number
  total: number
  clue: string | null
  finished: boolean
  rank: number | null
}

export type LoginResult = { ok: false; error: 'invalid_team_code' } | TeamView

export type SubmitResult =
  | { ok: false; error: 'invalid_team_code' | 'game_not_live' | 'already_finished' }
  | { ok: false; error: 'cooldown'; retry_after_seconds: number }
  | { ok: true; correct: false; reason: 'wrong' | 'already_used' }
  | { ok: true; correct: true; finished: false; position: number; total: number; clue: string }
  | { ok: true; correct: true; finished: true; position: number; total: number; rank: number }

export async function teamLogin(teamCode: string): Promise<LoginResult> {
  const { data, error } = await supabase.rpc('team_login', { p_team_code: teamCode })
  if (error) throw error
  return data as LoginResult
}

export async function submitCode(teamCode: string, code: string): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw error
  return data as SubmitResult
}
