import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ScratchCard from './ScratchCard'
import type { Card } from '../lib/api'

function card(overrides: Partial<Card> = {}): Card {
  return { level: 2, unlocked: true, opened: false, clue: 'Behind the coffee machine', ...overrides }
}

/**
 * jsdom has no 2D context, so without a stub every test here only ever exercised
 * the fallback button — the pointer handlers, the erase, the coordinate mapping
 * and the 55% threshold were all untested. This is a hand-rolled stub (no new
 * dependency): just the handful of methods the component calls, plus a
 * getImageData whose alpha bytes the test controls.
 */
type Stub = {
  install: () => void
  uninstall: () => void
  /** Fraction of sampled pixels reported as fully cleared (alpha 0). */
  setCleared: (fraction: number) => void
  calls: { arc: [number, number, number][]; getImageData: number; drawImage: number }
}

function contextStub(): Stub {
  let cleared = 0
  const calls = { arc: [] as [number, number, number][], getImageData: 0, drawImage: 0 }
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const originalCapture = Element.prototype.setPointerCapture
  const originalRect = HTMLCanvasElement.prototype.getBoundingClientRect

  function make() {
    return {
      fillStyle: '',
      globalCompositeOperation: '',
      imageSmoothingEnabled: true,
      fillRect: () => {},
      clearRect: () => {},
      beginPath: () => {},
      fill: () => {},
      arc: (x: number, y: number, r: number) => { calls.arc.push([x, y, r]) },
      drawImage: () => { calls.drawImage += 1 },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        calls.getImageData += 1
        const count = Math.max(w * h, 0)
        const data = new Uint8ClampedArray(count * 4)
        const clearedPixels = Math.round(count * cleared)
        for (let i = 0; i < count; i++) {
          data[i * 4 + 3] = i < clearedPixels ? 0 : 255
        }
        return { data, width: w, height: h }
      },
    }
  }

  return {
    install() {
      HTMLCanvasElement.prototype.getContext = function getContext() {
        return make()
      } as unknown as typeof HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getBoundingClientRect = function rect() {
        return { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 120, width: 200, height: 120, toJSON: () => ({}) }
      }
      Element.prototype.setPointerCapture = () => {}
    },
    uninstall() {
      HTMLCanvasElement.prototype.getContext = originalGetContext
      HTMLCanvasElement.prototype.getBoundingClientRect = originalRect
      Element.prototype.setPointerCapture = originalCapture
      cleared = 0
    },
    setCleared(fraction: number) { cleared = fraction },
    calls,
  }
}

describe('ScratchCard', () => {
  it('shows a padlock and no clue for a locked card', () => {
    render(<ScratchCard card={card({ unlocked: false, clue: null })} isCurrent={false} onOpen={vi.fn()} />)
    expect(screen.getByText(/locked/i)).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows the clue outright once opened', () => {
    render(<ScratchCard card={card({ opened: true })} isCurrent onOpen={vi.fn()} />)
    expect(screen.getByText('Behind the coffee machine')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers a reveal control for an unopened card and reports the open once', async () => {
    const onOpen = vi.fn()
    render(<ScratchCard card={card()} isCurrent onOpen={onOpen} />)
    const button = screen.getByRole('button', { name: /scratch|reveal/i })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(2)
  })

  it('keeps the clue in the accessibility tree while still covered', () => {
    render(<ScratchCard card={card()} isCurrent onOpen={vi.fn()} />)
    expect(screen.getByText('Behind the coffee machine')).toBeInTheDocument()
  })
})

describe('ScratchCard canvas scratching', () => {
  let stub: Stub

  beforeEach(() => {
    stub = contextStub()
    stub.install()
  })

  afterEach(() => stub.uninstall())

  // jsdom has no PointerEvent, and a bare Event drops clientX/clientY, so build a
  // MouseEvent and give it the pointer type React dispatches on.
  function pointer(type: string, target: Element, clientX = 0, clientY = 0) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    fireEvent(target, event)
  }

  function scratch(canvas: Element, points: [number, number][]) {
    pointer('pointerdown', canvas, points[0][0], points[0][1])
    for (const [clientX, clientY] of points.slice(1)) {
      pointer('pointermove', canvas, clientX, clientY)
    }
  }

  function renderCard(onOpen = vi.fn()) {
    const { container } = render(<ScratchCard card={card()} isCurrent onOpen={onOpen} />)
    const canvas = container.querySelector('canvas')!
    expect(canvas).toBeTruthy()
    // The foil painted, so the fallback button is gone and the canvas is live.
    expect(screen.queryByRole('button', { name: /scratch to reveal/i })).not.toBeInTheDocument()
    return { canvas, onOpen }
  }

  it('paints the foil and takes the canvas path rather than the fallback button', () => {
    renderCard()
  })

  it('reports the open exactly once across a whole drag', () => {
    const { canvas, onOpen } = renderCard()
    scratch(canvas, [[10, 10], [20, 20], [30, 30], [40, 40], [50, 50], [60, 60], [70, 70]])
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(2)
  })

  it('erases at the mapped canvas coordinates', () => {
    const { canvas } = renderCard()
    scratch(canvas, [[100, 60]])
    // 200x120 CSS box painted 1:1, so a click at (100, 60) erases at (100, 60).
    expect(stub.calls.arc[0][0]).toBeCloseTo(100)
    expect(stub.calls.arc[0][1]).toBeCloseTo(60)
  })

  it('samples every sixth stroke, not every pointermove', () => {
    const { canvas } = renderCard()
    scratch(canvas, Array.from({ length: 6 }, (_, i) => [i * 10, i * 10] as [number, number]))
    expect(stub.calls.getImageData).toBe(1)
    scratch(canvas, Array.from({ length: 6 }, (_, i) => [i * 10, i * 10] as [number, number]))
    expect(stub.calls.getImageData).toBe(2)
  })

  it('samples a downscaled offscreen copy, not the live buffer', () => {
    const { canvas } = renderCard()
    scratch(canvas, Array.from({ length: 6 }, (_, i) => [i * 10, i * 10] as [number, number]))
    expect(stub.calls.drawImage).toBe(1)
    expect(stub.calls.getImageData).toBe(1)
  })

  it('keeps the foil while cleared coverage is below the 55% threshold', () => {
    const { canvas } = renderCard()
    stub.setCleared(0.5)
    scratch(canvas, Array.from({ length: 12 }, (_, i) => [i * 10, i * 5] as [number, number]))
    expect(canvas.isConnected).toBe(true)
  })

  it('reveals the clue once cleared coverage crosses the 55% threshold', () => {
    const { canvas } = renderCard()
    stub.setCleared(0.56)
    scratch(canvas, Array.from({ length: 6 }, (_, i) => [i * 10, i * 5] as [number, number]))
    expect(canvas.isConnected).toBe(false)
    expect(screen.getByText('Behind the coffee machine')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /scratch to reveal/i })).not.toBeInTheDocument()
  })

  it('ignores pointermove once the drag was cancelled', () => {
    const { canvas } = renderCard()
    scratch(canvas, [[10, 10]])
    pointer('pointercancel', canvas)
    const arcsSoFar = stub.calls.arc.length
    pointer('pointermove', canvas, 90, 90)
    expect(stub.calls.arc).toHaveLength(arcsSoFar)
  })

  it('ignores pointermove after pointerup', () => {
    const { canvas } = renderCard()
    scratch(canvas, [[10, 10]])
    pointer('pointerup', canvas)
    const arcsSoFar = stub.calls.arc.length
    pointer('pointermove', canvas, 90, 90)
    expect(stub.calls.arc).toHaveLength(arcsSoFar)
  })
})
