import { parseClue, type ClueSpan } from './clueMarkup'

/**
 * Renders a clue's markup. Shared by the player's clue sheet and the admin's
 * preview so what the game master writes is exactly what the team reads.
 *
 * Spans arrive as data from parseClue, and each one becomes an element here, so
 * no clue ever reaches the DOM as markup.
 */
function Run({ span }: { span: ClueSpan }) {
  if (span.bold) return <strong>{span.text}</strong>
  if (span.italic) return <em>{span.text}</em>
  return <>{span.text}</>
}

type Props = { clue: string | null; className?: string; testId?: string }

export default function ClueText({ clue, className, testId }: Props) {
  return (
    <div className={className} data-testid={testId}>
      {parseClue(clue).map((block, index) =>
        block.kind === 'divider' ? (
          <p className="clue-divider" aria-hidden="true" key={index}>❖</p>
        ) : (
          <p className="clue-stanza" key={index}>
            {block.lines.map((line, lineIndex) => (
              <span className="clue-line" key={lineIndex}>
                {line.map((span, spanIndex) => <Run span={span} key={spanIndex} />)}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  )
}
