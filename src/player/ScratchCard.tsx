import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card } from '../lib/api'
import { CoinSprite, LockSprite } from './sprites'

type Props = {
  card: Card
  isCurrent: boolean
  onOpen: (level: number) => void
}

const REVEAL_AT = 0.55
const BRUSH = 22

export default function ScratchCard({ card, isCurrent, onOpen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [scratching, setScratching] = useState(false)
  const [revealed, setRevealed] = useState(card.opened)
  const [canScratch, setCanScratch] = useState(false)
  const reported = useRef(card.opened)

  const report = useCallback(() => {
    if (reported.current) return
    reported.current = true
    onOpen(card.level)
  }, [card.level, onOpen])

  // Paint the foil. The canvas is always mounted while covered so this ref is
  // populated; canScratch only flips once painting actually succeeds. jsdom
  // (no 2D context) and reduced-motion users fall back to the reveal button.
  useEffect(() => {
    if (card.opened || !card.unlocked) return
    const canvas = canvasRef.current
    const context = canvas?.getContext?.('2d')
    if (!canvas || !context) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const { width, height } = canvas.getBoundingClientRect()
    const paintWidth = Math.floor(width)
    const paintHeight = Math.floor(height)
    if (paintWidth <= 0 || paintHeight <= 0) return
    canvas.width = paintWidth
    canvas.height = paintHeight
    context.fillStyle = '#2121de'
    context.fillRect(0, 0, canvas.width, canvas.height)
    // Dither dots so the foil reads as pixel art rather than a flat block
    context.fillStyle = '#4a4aff'
    for (let y = 0; y < canvas.height; y += 6) {
      for (let x = (y / 6) % 2 === 0 ? 0 : 3; x < canvas.width; x += 6) {
        context.fillRect(x, y, 3, 3)
      }
    }
    setCanScratch(true)
  }, [card.opened, card.unlocked])

  const scratchAt = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      const box = canvas.getBoundingClientRect()
      const x = ((event.clientX - box.left) / box.width) * canvas.width
      const y = ((event.clientY - box.top) / box.height) * canvas.height
      context.globalCompositeOperation = 'destination-out'
      context.beginPath()
      context.arc(x, y, BRUSH, 0, Math.PI * 2)
      context.fill()
      report()

      // Sample a downscaled copy rather than the full bitmap each stroke
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let clear = 0
      for (let i = 3; i < data.length; i += 4 * 64) {
        if (data[i] === 0) clear++
      }
      if (clear / (data.length / (4 * 64)) >= REVEAL_AT) setRevealed(true)
    },
    [report],
  )

  if (!card.unlocked) {
    return (
      <div className="scratch-card is-locked">
        <LockSprite className="sprite" />
        <span className="scratch-level">{card.level}</span>
        <span className="scratch-state">Locked</span>
      </div>
    )
  }

  const showFoil = !revealed

  return (
    <div className={`scratch-card${isCurrent ? ' is-current' : ''}`}>
      <span className="scratch-level">
        <CoinSprite className="sprite sprite-sm" />
        {card.level}
      </span>
      <p className="scratch-clue">{card.clue}</p>
      {showFoil && (
        <canvas
          ref={canvasRef}
          className="scratch-foil"
          style={{ pointerEvents: canScratch ? undefined : 'none' }}
          onPointerDown={event => {
            setScratching(true)
            event.currentTarget.setPointerCapture(event.pointerId)
            scratchAt(event)
          }}
          onPointerMove={event => scratching && scratchAt(event)}
          onPointerUp={() => setScratching(false)}
        />
      )}
      {showFoil && !canScratch && (
        <button
          type="button"
          className="scratch-reveal"
          onClick={() => {
            report()
            setRevealed(true)
          }}
        >
          Scratch to reveal
        </button>
      )}
    </div>
  )
}
