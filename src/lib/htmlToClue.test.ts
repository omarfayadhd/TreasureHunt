import { htmlToClue, splitClueSections, splitTeamQuestions } from './htmlToClue'

describe('htmlToClue', () => {
  it('keeps plain text as it is', () => {
    expect(htmlToClue('<p>Where the mugs live</p>')).toBe('Where the mugs live')
  })

  it('turns <b> and <strong> into bold markup', () => {
    expect(htmlToClue('<p>Two things <b>begin</b> and <strong>end</strong></p>'))
      .toBe('Two things **begin** and **end**')
  })

  it('turns <i> and <em> into italic markup', () => {
    expect(htmlToClue('<p>look <i>behind</i> the <em>milk</em></p>'))
      .toBe('look *behind* the *milk*')
  })

  // Google Docs, Google Chat and Word all paste weight as a styled span.
  it('reads bold from an inline font-weight style', () => {
    expect(htmlToClue('<p>Your <span style="font-weight:700">body</span> knows</p>'))
      .toBe('Your **body** knows')
    expect(htmlToClue('<p>Your <span style="font-weight: bold;">body</span> knows</p>'))
      .toBe('Your **body** knows')
  })

  it('reads italic from an inline font-style', () => {
    expect(htmlToClue('<p>a small room that is always <span style="font-style:italic">awake</span></p>'))
      .toBe('a small room that is always *awake*')
  })

  it('ignores a normal font-weight on a span', () => {
    expect(htmlToClue('<p><span style="font-weight:400">plain</span></p>')).toBe('plain')
  })

  it('makes <br> a line break and a paragraph a verse break', () => {
    expect(htmlToClue('<p>It isn\'t time.<br>It isn\'t money.</p><p>But your body knows.</p>'))
      .toBe("It isn't time.\nIt isn't money.\n\nBut your body knows.")
  })

  it('turns <hr> into the ornament rule', () => {
    expect(htmlToClue('<p>Two things begin</p><hr><p>Where are you going?</p>'))
      .toBe('Two things begin\n\n---\n\nWhere are you going?')
  })

  it('decodes the entities a clipboard paste is full of', () => {
    expect(htmlToClue('<p>don&#39;t&nbsp;climb &amp; wait &lt;here&gt;</p>'))
      .toBe("don't climb & wait <here>")
  })

  it('drops styling wrappers, scripts and comments', () => {
    expect(htmlToClue('<div class="x"><style>p{color:red}</style><!-- note --><span>Kitchen</span></div>'))
      .toBe('Kitchen')
  })

  it('collapses the blank-line soup that pasted HTML produces', () => {
    expect(htmlToClue('<p>one</p><p></p><p></p><p>two</p>')).toBe('one\n\ntwo')
  })

  it('handles nesting without doubling the markers', () => {
    expect(htmlToClue('<p><b>Where are <i>you</i> going?</b></p>'))
      .toBe('**Where are *you* going?**')
  })

  // A chat paste puts each line in its own <b>, separated by <br>. Collapsing
  // the empty pair between them must not eat the line break with it.
  it('keeps the line break between two adjacent bold lines', () => {
    expect(htmlToClue('<div><b>first line</b><br><b>second line</b></div>'))
      .toBe('**first line**\n**second line**')
  })

  it('closes bold that the source left open at the end of a block', () => {
    expect(htmlToClue('<div><b>unclosed</div><div>next verse</div>'))
      .toBe('**unclosed**\n\nnext verse')
  })

  it('survives text with no tags at all', () => {
    expect(htmlToClue('just a line')).toBe('just a line')
  })
})

describe('splitClueSections', () => {
  it('reads a heading as a location name and the rest as its clue', () => {
    const sections = splitClueSections(
      '<h2>Reception desk</h2><p>Two things <b>begin</b></p><h2>Kitchen fridge</h2><p>Somewhere cold</p>',
    )
    expect(sections).toEqual([
      { name: 'Reception desk', clue: 'Two things **begin**' },
      { name: 'Kitchen fridge', clue: 'Somewhere cold' },
    ])
  })

  it('accepts any heading level and ignores empty sections', () => {
    const sections = splitClueSections('<h1>Vault</h1><p>Deep down</p><h3>Empty</h3>')
    expect(sections).toEqual([{ name: 'Vault', clue: 'Deep down' }])
  })

  it('falls back to one unnamed section when there are no headings', () => {
    expect(splitClueSections('<p>Just one clue</p>')).toEqual([{ name: '', clue: 'Just one clue' }])
  })

  it('strips markup out of the heading itself', () => {
    expect(splitClueSections('<h2><b>Fire</b> stairwell</h2><p>Up you go</p>')[0].name)
      .toBe('Fire stairwell')
  })
})

describe('splitTeamQuestions', () => {
  const paste = [
    '<div>Team 1 - Q1 :<br><b>First clue</b><br>second line</div>',
    '<div>Subin Viju, 8:03 PM</div><div>, Edited</div>',
    '<div>Team 1 - Q2:<br><b>Second clue</b></div>',
    '<div>------------------------------------------</div>',
    '<div>Team 2 Questions :</div>',
    '<div>Team 2 - Q1:<br>Decode me</div>',
  ].join('')

  it('groups clues by team and question number', () => {
    expect(splitTeamQuestions(paste)).toEqual([
      { team: 1, question: 1, clue: '**First clue**\nsecond line' },
      { team: 1, question: 2, clue: '**Second clue**' },
      { team: 2, question: 1, clue: 'Decode me' },
    ])
  })

  it('drops the chat chrome around the clues', () => {
    const clues = splitTeamQuestions(paste).map(c => c.clue).join('\n')
    expect(clues).not.toMatch(/Subin Viju|8:03 PM|Edited|Questions|-{6}/)
  })

  it('tolerates a missing colon and stray whitespace in the marker', () => {
    expect(splitTeamQuestions('<div>Team 3 - Q4<br>Go slow</div>')).toEqual([
      { team: 3, question: 4, clue: 'Go slow' },
    ])
  })

  it('drops a trailing line that is only emphasis markers', () => {
    const [only] = splitTeamQuestions('<div>Team 2 - Q2:<br><b>SUNSET</b><br><b></b><br><b></b></div>')
    expect(only.clue).toBe('**SUNSET**')
  })

  it('strips broken tag remnants that survived the paste', () => {
    const [only] = splitTeamQuestions('<div>Team 2 - Q3:<br>from the trees. /span&gt;</div>')
    expect(only.clue).toBe('from the trees.')
  })

  it('returns nothing when there are no markers', () => {
    expect(splitTeamQuestions('<p>no markers here</p>')).toEqual([])
  })
})
