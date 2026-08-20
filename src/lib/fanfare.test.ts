import { playFanfare, isMuted, setMuted } from './fanfare'

type StubNode = {
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  frequency: { value: number; setValueAtTime: ReturnType<typeof vi.fn> }
  gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> }
  type: string
}

function node(): StubNode {
  return {
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    frequency: { value: 0, setValueAtTime: vi.fn() },
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    type: '',
  }
}

function audioStub() {
  const oscillators: StubNode[] = []
  const context = {
    currentTime: 0,
    destination: {},
    state: 'running',
    resume: vi.fn(),
    close: vi.fn(),
    createOscillator: vi.fn(() => {
      const n = node()
      oscillators.push(n)
      return n
    }),
    createGain: vi.fn(() => node()),
  }
  const Ctor = vi.fn(() => context)
  ;(window as unknown as { AudioContext: unknown }).AudioContext = Ctor
  return { context, oscillators, Ctor }
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  delete (window as unknown as { AudioContext?: unknown }).AudioContext
})

describe('playFanfare', () => {
  it('plays a rising run of notes', () => {
    const audio = audioStub()
    playFanfare()
    expect(audio.Ctor).toHaveBeenCalled()
    expect(audio.oscillators.length).toBeGreaterThanOrEqual(3)
    const pitches = audio.oscillators.map(o => o.frequency.value || o.frequency.setValueAtTime.mock.calls[0]?.[0])
    expect(pitches.slice(1).every((p, i) => p > pitches[i])).toBe(true)
  })

  it('stays silent when muted', () => {
    const audio = audioStub()
    setMuted(true)
    playFanfare()
    expect(audio.Ctor).not.toHaveBeenCalled()
  })

  it('remembers the mute setting across reloads', () => {
    setMuted(true)
    expect(isMuted()).toBe(true)
    setMuted(false)
    expect(isMuted()).toBe(false)
  })

  it('stays silent for someone who asked for reduced motion', () => {
    const audio = audioStub()
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    playFanfare()
    expect(audio.Ctor).not.toHaveBeenCalled()
  })

  it('does nothing at all where WebAudio is missing', () => {
    expect(() => playFanfare()).not.toThrow()
  })
})
