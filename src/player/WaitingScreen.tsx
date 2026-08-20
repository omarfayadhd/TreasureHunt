import type { GameStatus } from '../lib/api'

type Props = {
  status: Exclude<GameStatus, 'live'>
  teamName: string
}

export default function WaitingScreen({ status, teamName }: Props) {
  const copy = {
    setup: {
      emoji: '⏳',
      title: `Hold tight, ${teamName}!`,
      body: "The hunt hasn't started yet. Your first clue will appear here the moment it does.",
    },
    paused: {
      emoji: '⏸️',
      title: 'The hunt is paused',
      body: 'Stay where you are — the game master will resume shortly.',
    },
    ended: {
      emoji: '🏁',
      title: 'The hunt is over',
      body: 'Thanks for playing! Gather round for the results.',
    },
  }[status]

  return (
    <div className="player-screen center-screen">
      <div className="emoji-orb" aria-hidden="true">{copy.emoji}</div>
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
    </div>
  )
}
