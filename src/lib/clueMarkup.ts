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

const MARKS = /\*\*(.+?)\*\*|\*(.+?)\*/g
const DIVIDER = /^-{3,}$/

function parseLine(line: string): ClueSpan[] {
  const spans: ClueSpan[] = []
  let cursor = 0
  for (const match of line.matchAll(MARKS)) {
    const at = match.index ?? 0
    if (at > cursor) spans.push({ text: line.slice(cursor, at), bold: false, italic: false })
    const [, bold, italic] = match
    spans.push({ text: bold ?? italic ?? '', bold: bold !== undefined, italic: italic !== undefined })
    cursor = at + match[0].length
  }
  if (cursor < line.length) spans.push({ text: line.slice(cursor), bold: false, italic: false })
  return spans
}

export function parseClue(raw: string | null | undefined): ClueBlock[] {
  const blocks: ClueBlock[] = []
  let stanza: ClueSpan[][] = []

  const flush = () => {
    if (stanza.length) blocks.push({ kind: 'stanza', lines: stanza })
    stanza = []
  }

  for (const line of (raw ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      flush()
    } else if (DIVIDER.test(trimmed)) {
      flush()
      blocks.push({ kind: 'divider' })
    } else {
      stanza.push(parseLine(trimmed))
    }
  }
  flush()
  return blocks
}
