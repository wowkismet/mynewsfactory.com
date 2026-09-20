/**
 * Opaque pagination cursors.
 *
 * A cursor arrives from the client, so it is untrusted input (§8). It is
 * decoded defensively: anything malformed yields `null`, which callers treat as
 * "start from the beginning" rather than an error. The encoded values are only
 * ever used as bound query parameters, never interpolated into SQL.
 */

export interface Cursor {
  /** ISO-8601 timestamp of the last item on the previous page. */
  publishedAt: string
  /** Its id, which breaks ties between items sharing a timestamp. */
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.publishedAt}|${cursor.id}`, 'utf8').toString('base64url')
}

/** Decodes a cursor, returning null for anything that is not a valid one. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (raw == null || raw === '') return null

  // A cursor is short. Refusing an oversized one early avoids decoding
  // arbitrary attacker-supplied volume (§8, request-size limits).
  if (raw.length > 256) return null

  let decoded: string
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const separator = decoded.indexOf('|')
  if (separator < 0) return null

  const publishedAt = decoded.slice(0, separator)
  const id = decoded.slice(separator + 1)

  if (!UUID.test(id)) return null
  if (Number.isNaN(Date.parse(publishedAt))) return null

  return { publishedAt, id }
}

/** Page sizes are clamped: a client does not get to ask for the whole table. */
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE
  const whole = Math.floor(requested)
  if (whole < 1) return 1
  if (whole > MAX_PAGE_SIZE) return MAX_PAGE_SIZE
  return whole
}
