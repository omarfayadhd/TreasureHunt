/**
 * The clue markup: a deliberately tiny subset of markdown.
 *
 *   **bold**            *italic*
 *   one newline         a new line in the same stanza
 *   a blank line        a new stanza
 *   --- on its own      an ornament divider
 *
 * Everything else — including anything that looks like HTML — is literal text.
 * Clues are written by an admin but read on every player's phone, so the render
 * path never interprets markup: parseClue returns data, and the components turn
 * that data into elements. There is no HTML string anywhere in between.
 */

export type ClueSpan = { text: string; bold: boolean; italic: boolean }
export type ClueBlock = { kind: 'stanza'; lines: ClueSpan[][] } | { kind: 'divider' }

// [\s\S] rather than `.`: a marked run routinely wraps a line, because clue
// verses break after a comma. It still cannot cross a verse break — stanzas are
// parsed one at a time, so a blank line ends any run.
const MARKS = /\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*/g
const DIVIDER = /^-{3,}$/

/** Marks up one verse, then cuts it back into the lines the author typed. */
function parseStanza(stanza: string): ClueSpan[][] {
  const spans: ClueSpan[] = []
  let cursor = 0
  for (const match of stanza.matchAll(MARKS)) {
    const at = match.index ?? 0
    if (at > cursor) spans.push({ text: stanza.slice(cursor, at), bold: false, italic: false })
    const [, bold, italic] = match
    spans.push({ text: bold ?? italic ?? '', bold: bold !== undefined, italic: italic !== undefined })
    cursor = at + match[0].length
  }
  if (cursor < stanza.length) {
    spans.push({ text: stanza.slice(cursor), bold: false, italic: false })
  }

  // A span that wrapped a line becomes one span per line, each keeping the
  // emphasis, so the verse still renders with the breaks the author typed.
  const lines: ClueSpan[][] = [[]]
  for (const span of spans) {
    const pieces = span.text.split('\n')
    pieces.forEach((text, index) => {
      if (index > 0) lines.push([])
      if (text !== '') lines[lines.length - 1].push({ ...span, text })
    })
  }
  return lines.filter(line => line.length > 0)
}

export function parseClue(raw: string | null | undefined): ClueBlock[] {
  const blocks: ClueBlock[] = []
  let pending: string[] = []

  const flush = () => {
    if (pending.length) {
      const lines = parseStanza(pending.join('\n'))
      if (lines.length) blocks.push({ kind: 'stanza', lines })
    }
    pending = []
  }

  for (const line of (raw ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      flush()
    } else if (DIVIDER.test(trimmed)) {
      flush()
      blocks.push({ kind: 'divider' })
    } else {
      pending.push(trimmed)
    }
  }
  flush()
  return blocks
}
