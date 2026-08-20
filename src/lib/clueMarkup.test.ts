import { parseClue } from './clueMarkup'

describe('parseClue', () => {
  it('reads a plain line as one line of plain text', () => {
    expect(parseClue('Where the mugs live')).toEqual([
      { kind: 'stanza', lines: [[{ text: 'Where the mugs live', bold: false, italic: false }]] },
    ])
  })

  it('marks **double asterisks** as bold', () => {
    expect(parseClue('Two things **begin** here')).toEqual([
      {
        kind: 'stanza',
        lines: [[
          { text: 'Two things ', bold: false, italic: false },
          { text: 'begin', bold: true, italic: false },
          { text: ' here', bold: false, italic: false },
        ]],
      },
    ])
  })

  it('marks *single asterisks* as italic', () => {
    expect(parseClue('look *behind* the milk')).toEqual([
      {
        kind: 'stanza',
        lines: [[
          { text: 'look ', bold: false, italic: false },
          { text: 'behind', bold: false, italic: true },
          { text: ' the milk', bold: false, italic: false },
        ]],
      },
    ])
  })

  it('keeps a single newline as a new line inside the same stanza', () => {
    const parsed = parseClue('A letter that follows R,\nand a number after 1.')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ kind: 'stanza' })
    expect((parsed[0] as { lines: unknown[] }).lines).toHaveLength(2)
  })

  it('splits stanzas on a blank line', () => {
    const parsed = parseClue('Put them together.\n\nBut do not climb yet.')
    expect(parsed.map(block => block.kind)).toEqual(['stanza', 'stanza'])
  })

  it('reads --- on its own line as a divider', () => {
    expect(parseClue('Two things begin:\n\n---\n\nWhere are you going?').map(b => b.kind))
      .toEqual(['stanza', 'divider', 'stanza'])
  })

  it('leaves raw HTML as literal text rather than markup', () => {
    const parsed = parseClue('<script>alert(1)</script>')
    expect(parsed).toEqual([
      {
        kind: 'stanza',
        lines: [[{ text: '<script>alert(1)</script>', bold: false, italic: false }]],
      },
    ])
  })

  it('leaves an unclosed marker as literal text', () => {
    expect(parseClue('2 ** 3 is not bold')).toEqual([
      { kind: 'stanza', lines: [[{ text: '2 ** 3 is not bold', bold: false, italic: false }]] },
    ])
  })

  it('returns nothing for an empty clue', () => {
    expect(parseClue('')).toEqual([])
    expect(parseClue(null)).toEqual([])
  })

  it('trims trailing blank lines instead of emitting empty stanzas', () => {
    expect(parseClue('Only line\n\n\n')).toEqual([
      { kind: 'stanza', lines: [[{ text: 'Only line', bold: false, italic: false }]] },
    ])
  })
})
