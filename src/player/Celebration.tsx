import { useEffect, useRef, useState } from 'react'
import { isMuted, playFanfare, setMuted } from '../lib/fanfare'

type Confetto = { x: number; y: number; vx: number; vy: number; size: number; hue: number; spin: number }

const COUNT = 120
const GRAVITY = 0.12
const COLOURS = [48, 12, 320, 190, 130]

/**
 * Confetti and a fanfare for the team that got there first.
 *
 * The canvas is skipped entirely for anyone who asked for reduced motion — no
 * hidden animation loop, no wasted frames — and the sound has its own mute that
 * survives a reload. Both are decoration: the win screen reads fine without them.
 */
type Props = {
  /** Bump to celebrate again — the winner tapping the chest, as often as they like. */
  burst?: number
}

export default function Celebration({ burst = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [muted, setMutedState] = useState(() => isMuted())
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  useEffect(() => {
    playFanfare()
  }, [burst])

  useEffect(() => {
    if (reduced) return
    const canvas = canvasRef.current
    const context = canvas?.getContext?.('2d')
    if (!canvas || !context) return

    canvas.width = canvas.clientWidth || window.innerWidth
    canvas.height = canvas.clientHeight || window.innerHeight

    const pieces: Confetto[] = Array.from({ length: COUNT }, (_, i) => ({
      x: canvas.width / 2 + (i % 2 ? 1 : -1) * (i % 17) * 6,
      y: canvas.height * 0.35 - (i % 9) * 8,
      vx: (i % 11 - 5) * 0.9,
      vy: -(4 + (i % 7)),
      size: 5 + (i % 4) * 2,
      hue: COLOURS[i % COLOURS.length],
      spin: (i % 5 - 2) * 0.12,
    }))

    let frame = 0
    let raf = 0
    const draw = () => {
      frame += 1
      context.clearRect(0, 0, canvas.width, canvas.height)
      for (const piece of pieces) {
        piece.vy += GRAVITY
        piece.x += piece.vx
        piece.y += piece.vy
        context.save()
        context.translate(piece.x, piece.y)
        context.rotate(frame * piece.spin)
        context.fillStyle = `hsl(${piece.hue} 90% 60%)`
        // Square, unrotated pixels: the app is pixel art, not glossy.
        context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size)
        context.restore()
      }
      // Stop once everything has fallen past the bottom: no endless loop.
      if (pieces.some(p => p.y < canvas.height + 40) && frame < 600) {
        raf = requestAnimationFrame(draw)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [reduced, burst])

  return (
    <>
      {!reduced && <canvas ref={canvasRef} className="confetti" aria-hidden="true" />}
      <button
        type="button"
        className="mute-toggle"
        onClick={() => {
          const next = !muted
          setMuted(next)
          setMutedState(next)
        }}
      >
        {muted ? '🔇 Sound off' : '🔊 Mute'}
      </button>
    </>
  )
}
