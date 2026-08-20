import { supabase } from './supabaseClient'

export type { TeamStatus } from './rounds'
import type { TeamStatus } from './rounds'

export type GameStatus = 'setup' | 'live' | 'paused' | 'ended'

export type Card = {
  level: number
  unlocked: boolean
  opened: boolean
  clue: string | null
  /** The location this level sends the team to. Null while the card is locked. */
  location: string | null
}
export type Race = { level: number; found: number; teams: number }

export type TeamView = {
  ok: true
  team_name: string
  /** The demo team: plays for real, but never takes the treasure. */
  demo: boolean
  /** This demo run reached the treasure — celebrate, claim nothing. */
  demo_won: boolean
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
  | {
      ok: true
      correct: false
      reason: 'wrong' | 'already_used' | 'not_your_code' | 'treasure_claimed'
      view: TeamView
    }
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
 * ADMIN ONLY. Supabase authorizes `postgres_changes` per subscriber against
 * RLS, and anon has no policy on these tables, so an anon subscriber receives
 * nothing at all (probed: 0 of 3 events, where service_role got 3 of 3).
 * Opening RLS up for anon is not an option — `teams` holds every team's
 * team_code. The admin session is `authenticated` and covered by the "admin
 * full access" policies, so for the dashboard these events really do arrive;
 * players fall back to polling in `usePlayerGame`.
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
