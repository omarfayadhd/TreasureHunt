type Props = { className?: string }

/** Pixel sprites drawn on a 16-unit grid so they stay crisp when scaled. */
const grid = (name: string, paths: [string, string][], className?: string) => (
  <svg
    className={className}
    data-sprite={name}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    shapeRendering="crispEdges"
  >
    {paths.map(([d, fill]) => (
      <path key={d + fill} d={d} fill={fill} />
    ))}
  </svg>
)

export const ChestSprite = ({ className }: Props) =>
  grid(
    'chest',
    [
      ['M2 6h12v8H2z', '#8a4b12'],
      ['M3 3h10v3H3z', '#c98b2e'],
      ['M2 6h12v2H2z', '#ffd400'],
      ['M7 7h2v4H7z', '#ffd400'],
      ['M7 8h2v2H7z', '#8a4b12'],
      ['M2 14h12v1H2z', '#5a2f08'],
    ],
    className,
  )

export const LockSprite = ({ className }: Props) =>
  grid(
    'lock',
    [
      ['M5 7h6v7H5z', '#9aa0b5'],
      ['M6 3h4v4H6z', '#6f7590'],
      ['M7 4h2v3H7z', '#0b0b12'],
      ['M7 9h2v3H7z', '#0b0b12'],
    ],
    className,
  )

export const CoinSprite = ({ className }: Props) =>
  grid(
    'coin',
    [
      ['M5 3h6v10H5z', '#ffd400'],
      ['M4 5h1v6H4zM11 5h1v6h-1z', '#c9a400'],
      ['M7 5h2v6H7z', '#fff6b0'],
    ],
    className,
  )

export const GhostSprite = ({ className }: Props) =>
  grid(
    'ghost',
    [
      ['M4 5h8v8H4z', '#ff3b30'],
      ['M5 3h6v2H5z', '#ff3b30'],
      ['M4 13h2v2H4zM8 13h2v2H8z', '#ff3b30'],
      ['M6 6h2v3H6zM10 6h2v3h-2z', '#ffffff'],
      ['M7 7h1v2H7zM11 7h1v2h-1z', '#2121de'],
    ],
    className,
  )

export const FlagSprite = ({ className }: Props) =>
  grid(
    'flag',
    [
      ['M4 2h1v12H4z', '#9aa0b5'],
      ['M5 3h7v4H5z', '#33ffff'],
      ['M5 3h7v1H5z', '#ffffff'],
    ],
    className,
  )
