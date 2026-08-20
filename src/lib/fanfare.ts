/**
 * The win sound: a short rising arpeggio, synthesised on the spot.
 *
 * No audio file, so nothing to host, nothing to download, and it works offline.
 * It is always triggered by the tap that submitted the code, so the browser's
 * autoplay rules are satisfied without asking for permission.
 *
 * Silent for anyone who asked for reduced motion, and mutable by the player.
 */

const MUTE_KEY = 'treasure_muted'

/** C5 E5 G5 C6 — a plain major arpeggio reads as "you won" in any culture's ear. */
const NOTES = [523.25, 659.25, 783.99, 1046.5]
const NOTE_LENGTH = 0.14
const RELEASE = 0.35

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // A blocked localStorage only costs us the preference, never the sound.
  }
}

function silenced(): boolean {
  if (isMuted()) return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function playFanfare(): void {
  if (silenced()) return
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return

  try {
    const context = new Ctor()
    void context.resume?.()
    const start = context.currentTime

    NOTES.forEach((frequency, index) => {
      const at = start + index * NOTE_LENGTH
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      // Triangle, not sine: a little brighter, and it sits with the pixel-art tone.
      oscillator.type = 'triangle'
      oscillator.frequency.value = frequency
      // Ramp rather than switch, so the note does not click on or off.
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.linearRampToValueAtTime(0.22, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_LENGTH + RELEASE)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + NOTE_LENGTH + RELEASE)
    })

    // The top note rings on a fifth above, for the "ta-daa" tail.
    const shimmer = context.createOscillator()
    const shimmerGain = context.createGain()
    shimmer.type = 'triangle'
    shimmer.frequency.value = NOTES[NOTES.length - 1] * 1.5
    const shimmerAt = start + NOTES.length * NOTE_LENGTH
    shimmerGain.gain.setValueAtTime(0.0001, shimmerAt)
    shimmerGain.gain.linearRampToValueAtTime(0.12, shimmerAt + 0.03)
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, shimmerAt + 0.9)
    shimmer.connect(shimmerGain)
    shimmerGain.connect(context.destination)
    shimmer.start(shimmerAt)
    shimmer.stop(shimmerAt + 0.9)
  } catch {
    // A device that refuses to make sound must never break the win screen.
  }
}
