import { useId } from 'react'
import type { Color, PieceSymbol } from 'chess.js'

// Original vector Staunton set. One silhouette, bevel and lighting system at
// every size; no font glyphs, external images or per-platform substitutions.
export function Piece({ type, color }: { type: PieceSymbol; color: Color }) {
  const id = useId().replace(/:/g, '')
  const dark = color === 'b'
  const ink = dark ? '#272a25' : '#796c50'
  const fill = `url(#${id})`
  const paths: Record<PieceSymbol, React.ReactNode> = {
    p: (
      <>
        <circle cx="50" cy="27" r="12" />
        <path d="M39 43h22l-3 10 7 18H35l7-18z" />
        <path d="M36 40h28v7H36z" />
      </>
    ),
    r: (
      <>
        <path d="M28 17h10v11h7V17h10v11h7V17h10v22l-10 9 3 23H35l3-23-10-9z" />
        <path d="M34 39h32M38 48h24" fill="none" />
      </>
    ),
    n: (
      <>
        <path d="M31 71c-1-13 4-24 16-35l-11 7-11-6 11-17 14-5 8-7 2 11c14 7 18 24 14 52z" />
        <path d="m37 26 8 1M31 36l7 1M55 29c11 11 12 22 8 36" fill="none" />
        <circle cx="47" cy="25" r="2" fill={ink} stroke="none" />
      </>
    ),
    b: (
      <>
        <path d="M50 12c-4 6-18 17-18 27 0 8 8 12 18 12s18-4 18-12c0-10-14-21-18-27z" />
        <path d="m53 25-9 14" fill="none" strokeWidth="4" />
        <path d="M41 49h18l-2 7 9 15H34l9-15z" />
        <circle cx="50" cy="11" r="4" />
      </>
    ),
    q: (
      <>
        <path d="m27 29 11 10 12-17 12 17 11-10-9 28H36z" />
        <path d="M37 54h26v7H37zM41 61h18l8 10H33z" />
        <circle cx="25" cy="25" r="5" />
        <circle cx="50" cy="18" r="5" />
        <circle cx="75" cy="25" r="5" />
      </>
    ),
    k: (
      <>
        <path d="M46 8h8v7h7v7h-7v9h-8v-9h-7v-7h7z" />
        <path d="M50 34c-10-14-26-3-22 7l9 15h26l9-15c4-10-12-21-22-7z" />
        <path d="M37 54h26v7H37zM41 61h18l8 10H33z" />
        <path d="M50 35v16" fill="none" />
      </>
    ),
  }
  return (
    <svg className="piece-art" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2=".65">
          <stop stopColor={dark ? '#6b7060' : '#fffdf2'} />
          <stop offset=".38" stopColor={dark ? '#444a3c' : '#f3ead1'} />
          <stop offset="1" stopColor={dark ? '#252c24' : '#c9ba95'} />
        </linearGradient>
      </defs>
      <ellipse cx="51" cy="86" rx="27" ry="4" fill="#17251d" opacity=".18" />
      <g
        fill={fill}
        stroke={ink}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {paths[type]}
        <path d="M33 70h34l5 8H28z" />
        <path d="M28 78h44v7H28z" />
        <path
          d="M35 74h30M32 81h36"
          fill="none"
          stroke={dark ? '#7b816e' : '#fffbee'}
          strokeWidth="1.5"
          opacity=".7"
        />
      </g>
    </svg>
  )
}
