/**
 * Cursor tests.
 *
 * A cursor is client-supplied input, so most of these are about what happens
 * when it is malformed or hostile rather than when it is valid.
 */

import { describe, expect, it } from 'vitest'
import { clampLimit, decodeCursor, encodeCursor, MAX_PAGE_SIZE } from './cursor'

const VALID = { publishedAt: '2026-09-14T09:00:00.000Z', id: '2f1c5a9e-3b7d-4c21-9f60-8a1e4b2d7c03' }

describe('encode and decode', () => {
  it('round-trips a cursor', () => {
    expect(decodeCursor(encodeCursor(VALID))).toEqual(VALID)
  })

  it('produces a URL-safe string', () => {
    expect(encodeCursor(VALID)).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('rejecting bad input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not base64', '!!!!'],
    ['no separator', Buffer.from('nothing-here').toString('base64url')],
    ['id is not a uuid', Buffer.from('2026-09-14T09:00:00Z|not-a-uuid').toString('base64url')],
    ['date is not a date', Buffer.from(`nonsense|${VALID.id}`).toString('base64url')],
    ['sql in the id', Buffer.from("2026-09-14T09:00:00Z|' OR 1=1 --").toString('base64url')],
  ])('returns null for %s', (_name, input) => {
    expect(decodeCursor(input)).toBeNull()
  })

  it('refuses an oversized cursor without decoding it', () => {
    expect(decodeCursor('A'.repeat(10_000))).toBeNull()
  })
})

describe('clampLimit', () => {
  it('uses the default when unspecified', () => {
    expect(clampLimit(undefined)).toBe(20)
  })

  it('caps a request for the whole table', () => {
    expect(clampLimit(1_000_000)).toBe(MAX_PAGE_SIZE)
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
  ])('raises %s to one', (_name, input) => {
    expect(clampLimit(input)).toBe(1)
  })

  it('floors a fractional limit', () => {
    expect(clampLimit(7.9)).toBe(7)
  })

  it('falls back to the default for a non-finite limit', () => {
    expect(clampLimit(Number.NaN)).toBe(20)
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(20)
  })
})
