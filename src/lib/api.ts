import { supabase } from './supabaseClient'

export type { TeamStatus } from './rounds'
import type { TeamStatus } from './rounds'

export type GameStatus = 'setup' | 'live' | 'paused' | 'ended'

export type Card = { level: number; unlocked: boolean; opened: boolean; clue: string | null }
export type Race = { level: number; found: number; teams: number }

export type TeamView = {
  ok: true
  team_name: string
  game_status: GameStatus
  status: TeamStatus
  cleared: number
  total: number
  out_at_level: number | null
  place: number | null
  race: Race | null
  cards: Card[]
}

export type ViewResult = { ok: false; error: 'invalid_team_code' } | TeamView

export type SubmitResult =
  | { ok: false; error: 'invalid_team_code' | 'game_not_live' | 'not_playing' }
  | { ok: false; error: 'cooldown'; retry_after_seconds: number }
  | { ok: true; correct: false; reason: 'wrong' | 'already_used'; view: TeamView }
  | { ok: true; correct: true; view: TeamView }

export type OpenResult =
  | { ok: false; error: 'invalid_team_code' | 'game_not_live' | 'locked' | 'no_such_level' }
  | { ok: true; level: number; clue: string; view: TeamView }

export async function teamView(teamCode: string): Promise<ViewResult> {
  const { data, error } = await supabase.rpc('team_view', { p_team_code: teamCode })
  if (error) throw error
  return data as ViewResult
}

export async function submitCode(teamCode: string, code: string): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc('submit_code', { p_team_code: teamCode, p_code: code })
  if (error) throw error
  return data as SubmitResult
}

export async function openCard(teamCode: string, level: number): Promise<OpenResult> {
  const { data, error } = await supabase.rpc('open_card', { p_team_code: teamCode, p_level: level })
  if (error) throw error
  return data as OpenResult
}

/**
 * Any change to teams, the game row or card opens can change what this team
 * sees (a rival taking the last slot eliminates them without them acting), so
 * every event just triggers a refetch of the whole view.
 */
export function subscribeToGame(onChange: () => void): () => void {
  const channel = supabase
    .channel('hunt-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'card_opens' }, onChange)
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
