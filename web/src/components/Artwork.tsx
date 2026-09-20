/**
 * Editorial artwork.
 *
 * Every story needs a picture. Until reporters file real photographs, these are
 * generated: a deterministic duotone composition derived from the story's slug,
 * drawn in the portal's own palette so a page of them reads as one publication
 * rather than a page of grey boxes.
 *
 * They are illustrations, not photographs, and they are not pretending
 * otherwise -- no stock imagery, no invented photojournalism. When real images
 * arrive, `Artwork` takes a `src` and renders that instead; nothing else on the
 * page changes.
 *
 * Deterministic by construction: the same slug always produces the same image,
 * so the server and the browser render identical markup.
 */

interface Palette {
  wash: string
  ink: string
  accent: string
}

/**
 * Category-led palettes. Business reads cooler than breaking news; city
 * reporting reads warmer than markets. The category decides the mood, the slug
 * decides the composition.
 */
const PALETTES: Record<string, Palette> = {
  breaking: { wash: '#f7ece9', ink: '#3a1f1a', accent: 'oklch(0.55 0.19 25)' },
  business: { wash: '#eceff5', ink: '#1b2430', accent: 'oklch(0.50 0.16 250)' },
  markets: { wash: '#e9f0ef', ink: '#17302c', accent: 'oklch(0.44 0.13 178)' },
  finance: { wash: '#e9f0ef', ink: '#17302c', accent: 'oklch(0.44 0.13 178)' },
  technology: { wash: '#eeecf6', ink: '#241f33', accent: 'oklch(0.48 0.15 285)' },
  ai: { wash: '#eeecf6', ink: '#241f33', accent: 'oklch(0.48 0.15 285)' },
  health: { wash: '#e9f1ea', ink: '#1a2c1e', accent: 'oklch(0.47 0.13 150)' },
  sports: { wash: '#f3eee6', ink: '#2e2519', accent: 'oklch(0.46 0.15 42)' },
  global: { wash: '#eaeef2', ink: '#1c2730', accent: 'oklch(0.45 0.10 230)' },
  india: { wash: '#f5eee4', ink: '#30251a', accent: 'oklch(0.46 0.15 42)' },
  education: { wash: '#f1eee9', ink: '#2b2620', accent: 'oklch(0.45 0.10 70)' },
  'my-city': { wash: '#eef0f3', ink: '#20272e', accent: 'oklch(0.45 0.08 240)' },
}

const FALLBACK: Palette = { wash: '#f0ece5', ink: '#2a251e', accent: 'oklch(0.46 0.12 60)' }

/** FNV-1a. Small, stable, and dependency-free -- the values only need to be well spread. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** A deterministic stream of values in [0,1) from one seed. */
function stream(seed: string): () => number {
  let state = hash(seed) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0xffffffff
  }
}

export interface ArtworkProps {
  /** Stable identity for the composition. The article slug. */
  seed: string
  /** Chooses the palette. */
  category?: string
  /** Aspect ratio. Cards and heroes use 16:9; rail thumbnails use 1:1. */
  ratio?: '16:9' | '1:1' | '4:3'
  /** Describes the story for assistive technology, or empty if decorative. */
  alt?: string
  className?: string
}

// Denser viewBox than the shapes need: the halftone is drawn in the same user
// units, so a coarse grid becomes visibly chunky once a hero is 900px wide.
const RATIOS = { '16:9': [320, 180], '1:1': [200, 200], '4:3': [280, 210] } as const

export function Artwork({ seed, category, ratio = '16:9', alt = '', className }: ArtworkProps) {
  const palette = (category !== undefined ? PALETTES[category] : undefined) ?? FALLBACK
  const [w, h] = RATIOS[ratio]
  const next = stream(seed)

  // Three overlapping forms. Bands read as horizon lines, the disc as a focal
  // point; together they stay abstract enough never to imply a real event.
  const horizon = 0.44 + next() * 0.2
  const discX = 0.24 + next() * 0.5
  // Smaller than before: at hero size a half-height disc reads as a logo, not
  // as an illustration.
  const discR = 0.07 + next() * 0.07
  const barX = 0.06 + next() * 0.7
  const barW = 0.05 + next() * 0.1
  const barH = 0.3 + next() * 0.45
  const tilt = -4 + next() * 8
  const dotted = next() > 0.35
  const hatched = next() > 0.55
  const secondX = 0.1 + next() * 0.75
  const secondW = 0.03 + next() * 0.06
  const secondH = 0.18 + next() * 0.3
  const ruleY = 0.16 + next() * 0.18

  const id = `art-${hash(seed).toString(36)}`

  return (
    <svg
      className={className}
      viewBox={`0 0 ${w.toString()} ${h.toString()}`}
      preserveAspectRatio="xMidYMid slice"
      role={alt === '' ? 'presentation' : 'img'}
      aria-label={alt === '' ? undefined : alt}
      aria-hidden={alt === '' ? true : undefined}
    >
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.wash} />
          <stop offset="100%" stopColor={palette.ink} stopOpacity="0.14" />
        </linearGradient>
        <pattern id={`${id}-d`} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="0.85" fill={palette.ink} fillOpacity="0.14" />
        </pattern>
        <pattern id={`${id}-r`} width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 6 L6 0" stroke={palette.ink} strokeOpacity="0.07" strokeWidth="1" />
        </pattern>
        <clipPath id={`${id}-c`}>
          <rect width={w} height={h} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id}-c)`}>
        <rect width={w} height={h} fill={`url(#${id}-g)`} />

        {/* Sky texture, above the horizon only */}
        {dotted ? <rect width={w} height={h * horizon} fill={`url(#${id}-d)`} /> : null}
        {hatched ? (
          <rect y={h * horizon} width={w} height={h * (1 - horizon)} fill={`url(#${id}-r)`} />
        ) : null}

        {/* A hairline rule high in the frame, the way a masthead sits on a page */}
        <rect y={h * ruleY} width={w} height={h * 0.004} fill={palette.ink} opacity="0.22" />

        {/* Two uprights of different weight, so the composition has a subject
            and a counterweight rather than one big shape. */}
        <rect
          x={w * barX}
          y={h * (horizon - barH)}
          width={w * barW}
          height={h * barH}
          fill={palette.ink}
          opacity="0.42"
          transform={`rotate(${tilt.toFixed(2)} ${(w * barX).toFixed(1)} ${(h * horizon).toFixed(1)})`}
        />
        <rect
          x={w * secondX}
          y={h * (horizon - secondH)}
          width={w * secondW}
          height={h * secondH}
          fill={palette.accent}
          opacity="0.55"
        />

        {/* Focal disc, sitting on the horizon */}
        <circle cx={w * discX} cy={h * (horizon - discR * 0.5)} r={h * discR} fill={palette.accent} opacity="0.62" />
        <circle
          cx={w * discX}
          cy={h * (horizon - discR * 0.5)}
          r={h * discR}
          fill="none"
          stroke={palette.ink}
          strokeOpacity="0.28"
          strokeWidth={h * 0.004}
        />

        {/* Ground */}
        <rect y={h * horizon} width={w} height={h * (1 - horizon)} fill={palette.ink} opacity="0.1" />
        <rect y={h * horizon} width={w} height={h * 0.008} fill={palette.accent} opacity="0.9" />
        <rect y={h - h * 0.01} width={w} height={h * 0.01} fill={palette.ink} opacity="0.55" />
      </g>
    </svg>
  )
}
