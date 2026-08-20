import { render, screen } from '@testing-library/react'
import Celebration from './Celebration'
import * as fanfare from '../lib/fanfare'

vi.mock('../lib/fanfare', () => ({
  playFanfare: vi.fn(),
  isMuted: vi.fn(() => false),
  setMuted: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fanfare.isMuted).mockReturnValue(false)
})

describe('Celebration', () => {
  it('plays the fanfare once when it appears', () => {
    const { rerender } = render(<Celebration />)
    rerender(<Celebration />)
    expect(fanfare.playFanfare).toHaveBeenCalledTimes(1)
  })

  it('throws confetti on a canvas', () => {
    const { container } = render(<Celebration />)
    expect(container.querySelector('canvas.confetti')).toBeInTheDocument()
  })

  it('offers a mute toggle that sticks', async () => {
    render(<Celebration />)
    const button = screen.getByRole('button', { name: /mute|sound/i })
    button.click()
    expect(fanfare.setMuted).toHaveBeenCalledWith(true)
  })

  it('shows it is already muted', () => {
    vi.mocked(fanfare.isMuted).mockReturnValue(true)
    render(<Celebration />)
    expect(screen.getByRole('button', { name: /unmute|sound off/i })).toBeInTheDocument()
    expect(fanfare.playFanfare).toHaveBeenCalled()
  })

  it('skips the confetti canvas for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const { container } = render(<Celebration />)
    expect(container.querySelector('canvas.confetti')).not.toBeInTheDocument()
  })
})
