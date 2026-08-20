const WORDS = [
  'TIGER', 'EAGLE', 'RIVER', 'MAPLE', 'COMET', 'NINJA', 'ROBOT', 'PIXEL',
  'MANGO', 'ZEBRA', 'FALCON', 'CACTUS', 'ROCKET', 'PANDA', 'STORM', 'EMBER',
  'ORBIT', 'QUARTZ', 'SPARK', 'LEMUR',
]

/** Codes get typed on phones and read off paper: letters and digits only. */
export function generateCode(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)]
  const num = Math.floor(Math.random() * 90) + 10
  return `${word}${num}`
}
