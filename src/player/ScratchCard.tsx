import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card } from '../lib/api'
import { CoinSprite, FlagSprite, LockSprite } from './sprites'

type Props = {
  card: Card
  isCurrent: boolean
  /** The treasure level: flagged rather than coined, per the spec's sprite roles. */
  isFinal?: boolean
  onOpen: (level: number) => void
}

const REVEAL_AT = 0.55
const BRUSH = 22
/** Measure every Nth stroke, not every pointermove. */
const SAMPLE_EVERY = 6
/** Read back a 1/8-scale copy, so ~1/64 of the pixels. */
const SAMPLE_SCALE = 8

export default function ScratchCard({ card, isCurrent, isFinal = false, onOpen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [scratching, setScratching] = useState(false)
  const [revealed, setRevealed] = useState(card.opened)
  const [canScratch, setCanScratch] = useState(false)
  const reported = useRef(card.opened)
  const strokes = useRef(0)
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null)

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

  /**
   * Fraction of the foil that has been cleared, measured off a small offscreen
   * copy. getImageData on the live buffer forces a synchronous GPU->CPU readback
   * of the whole bitmap; at ~60 pointermove events a second on a phone that is
   * the most expensive thing on the screen. Nearest-neighbour downscaling (no
   * smoothing) makes each sampled pixel exactly one source pixel, so the
   * fraction still means "fraction of cleared pixels".
   */
  const clearedFraction = useCallback((canvas: HTMLCanvasElement): number => {
    const width = Math.floor(canvas.width / SAMPLE_SCALE)
    const height = Math.floor(canvas.height / SAMPLE_SCALE)
    if (width <= 0 || height <= 0) return 0

    const sample = sampleCanvas.current ?? document.createElement('canvas')
    sampleCanvas.current = sample
    sample.width = width
    sample.height = height
    const context = sample.getContext('2d')
    if (!context) return 0
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, width, height)
    context.drawImage(canvas, 0, 0, width, height)

    const { data } = context.getImageData(0, 0, width, height)
    // A zero-sized (or unreadable) measurement must never count as "cleared".
    if (data.length === 0) return 0
    let clear = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) clear++
    }
    return clear / (data.length / 4)
  }, [])

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

      strokes.current += 1
      if (strokes.current % SAMPLE_EVERY !== 0) return
      if (clearedFraction(canvas) >= REVEAL_AT) setRevealed(true)
    },
    [clearedFraction, report],
  )

  if (!card.unlocked) {
    return (
      <div className={`scratch-card is-locked${isFinal ? ' is-final' : ''}`}>
        <LockSprite className="sprite" />
        <span className="scratch-level">{card.level}</span>
        <span className="scratch-state">Locked</span>
      </div>
    )
  }

  const showFoil = !revealed

  return (
    <div className={`scratch-card${isCurrent ? ' is-current' : ''}${isFinal ? ' is-final' : ''}`}>
      <span className="scratch-level">
        {isFinal ? <FlagSprite className="sprite sprite-sm" /> : <CoinSprite className="sprite sprite-sm" />}
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
          // A drag interrupted by an incoming call or a browser gesture fires
          // pointercancel, not pointerup, and would otherwise leave the flag set.
          onPointerCancel={() => setScratching(false)}
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
