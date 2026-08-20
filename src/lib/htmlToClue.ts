/**
 * Turns pasted rich text into the clue markup (see `clueMarkup.ts`).
 *
 * Clues get written in Docs, Chat or Word and arrive as HTML on the clipboard —
 * usually as styled spans rather than <b>/<i>, which is why inline
 * `font-weight` and `font-style` count too.
 *
 * A deliberately small tag walker rather than a DOM parse: it runs unchanged in
 * the browser, in node and in a script, with no dependency and nothing to
 * install. It handles the tags a clipboard paste actually contains; it is not a
 * general HTML engine, and it does not need to be — the output is plain text
 * markup that a human reviews before it reaches the game.
 */

const BOLD_TAGS = new Set(['b', 'strong'])
const ITALIC_TAGS = new Set(['i', 'em'])
/** Tags whose *content* is never clue text. */
const DROPPED = new Set(['style', 'script', 'head', 'title', 'meta', 'link'])
/** Tags that end a verse rather than a line. */
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'section', 'blockquote'])

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
}

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10))
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

function styleMarks(attributes: string): { bold: boolean; italic: boolean } {
  const style = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(attributes)
  const declarations = (style?.[1] ?? style?.[2] ?? '').toLowerCase()
  const weight = /font-weight\s*:\s*([^;]+)/.exec(declarations)?.[1]?.trim()
  return {
    bold: weight === 'bold' || weight === 'bolder' || Number(weight) >= 600,
    italic: /font-style\s*:\s*italic/.test(declarations),
  }
}

/** Converts one run of rich text to clue markup. */
export function htmlToClue(html: string): string {
  let out = ''
  // One entry per open element, so a marker is closed by the tag that opened it.
  const stack: { tag: string; bold: boolean; italic: boolean }[] = []
  let skipUntil: string | null = null

  const emit = (text: string) => {
    out += text
  }

  const tokens = html.matchAll(/<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g)

  for (const token of tokens) {
    const [whole, rawTag, attributes = '', text] = token
    if (whole.startsWith('<!--')) continue

    if (text !== undefined) {
      if (skipUntil) continue
      // Newlines inside pasted HTML are formatting, not content.
      emit(decode(text).replace(/\s*\n\s*/g, ' '))
      continue
    }

    const tag = rawTag!.toLowerCase()
    const closing = whole.startsWith('</')

    if (skipUntil) {
      if (closing && tag === skipUntil) skipUntil = null
      continue
    }

    if (!closing && DROPPED.has(tag)) {
      skipUntil = tag
      continue
    }

    if (!closing && tag === 'br') {
      emit('\n')
      continue
    }
    if (!closing && tag === 'hr') {
      emit('\n\n---\n\n')
      continue
    }

    if (closing) {
      // Close the most recent matching element, and only its own markers.
      const index = stack.map(e => e.tag).lastIndexOf(tag)
      if (index !== -1) {
        const entry = stack[index]
        stack.splice(index, 1)
        if (entry.italic) emit('*')
        if (entry.bold) emit('**')
      }
      if (BLOCK.has(tag)) {
        // Markup cannot span a verse break, and a chat paste is full of <b>
        // that the source never closed. Close whatever is still open here, so
        // the emphasis ends with the block instead of bleeding into the next.
        for (let i = stack.length - 1; i >= 0; i--) {
          const entry = stack[i]
          if (entry.italic) emit('*')
          if (entry.bold) emit('**')
          entry.italic = false
          entry.bold = false
        }
        emit('\n\n')
      }
      continue
    }

    // Self-closing tags carry no content, so they open nothing.
    if (whole.endsWith('/>')) continue

    const style = styleMarks(attributes)
    const bold = BOLD_TAGS.has(tag) || style.bold
    const italic = ITALIC_TAGS.has(tag) || style.italic
    if (bold) emit('**')
    if (italic) emit('*')
    stack.push({ tag, bold, italic })
  }

  return out
    // Trailing spaces before a break are invisible in HTML and noise in markup.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // An empty bold pair is noise, but only collapse it within a line: across a
    // newline the pair is two separate bold lines with a break between them.
    .replace(/\*\*[ \t]*\*\*/g, '')
    .trim()
}

export type ClueSection = { name: string; clue: string }

/**
 * Splits a pasted page into one section per location: a heading names the place,
 * everything until the next heading is its clue.
 */
export function splitClueSections(html: string): ClueSection[] {
  const parts = html.split(/<h[1-6][^>]*>/i)
  if (parts.length === 1) {
    const clue = htmlToClue(html)
    return clue ? [{ name: '', clue }] : []
  }

  const sections: ClueSection[] = []
  for (const part of parts.slice(1)) {
    const [heading, body = ''] = part.split(/<\/h[1-6]\s*>/i)
    // A location name is a plain string — a bold heading is styling, not content.
    const name = htmlToClue(heading ?? '').replace(/\*+/g, '').trim()
    const clue = htmlToClue(body)
    if (name && clue) sections.push({ name, clue })
  }
  return sections
}

export type TeamQuestion = { team: number; question: number; clue: string }

/** `Team 3 - Q4:` — the marker a chat paste uses to label each clue. */
const MARKER = /Team\s*(\d+)\s*[-–—]\s*Q\s*(\d+)\s*:?/g
/** Chat chrome: a sender line, a timestamp, an edit note, a rule of dashes. */
const CHROME = [
  /^[^\n]{0,60},\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i,
  /^,?\s*Edited\s*$/i,
  /^Team\s*\d+\s*Questions?\s*:?\s*$/i,
  /^[-–—_=]{6,}$/,
]

function withoutChrome(clue: string): string {
  return clue
    .split('\n')
    .filter(line => !CHROME.some(pattern => pattern.test(line.trim())))
    .join('\n')
    // Half-escaped tag remnants: a paste that lost its opening bracket leaves
    // "/span>" or "span>" sitting in the text.
    .replace(/\s*\/?\s*(?:span|div|b|i|em|strong)>\s*/gi, ' ')
    .split('\n')
    .map(line => (/^[*\s]+$/.test(line) ? '' : line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Pulls per-team clues out of a chat or document paste labelled
 * `Team 1 - Q1:`, `Team 1 - Q2:` and so on.
 *
 * Each team's questions are its own clues, in order, so question N becomes that
 * team's level N. Sender names, timestamps, "Edited" and separator rules are
 * dropped: they are the chat around the clue, not the clue.
 */
export function splitTeamQuestions(html: string): TeamQuestion[] {
  const text = htmlToClue(html)
  const markers = [...text.matchAll(MARKER)]
  const found: TeamQuestion[] = []

  markers.forEach((marker, index) => {
    const from = (marker.index ?? 0) + marker[0].length
    const to = index + 1 < markers.length ? markers[index + 1].index : text.length
    const clue = withoutChrome(text.slice(from, to))
    if (clue) {
      found.push({ team: Number(marker[1]), question: Number(marker[2]), clue })
    }
  })

  return found.sort((a, b) => a.team - b.team || a.question - b.question)
}
