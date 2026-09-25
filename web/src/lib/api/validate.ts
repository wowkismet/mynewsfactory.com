/**
 * Input validation (§77, §83).
 *
 * §77 requires every API to validate its input. That is done here rather than
 * with a schema library for the reason D-011 gives for the database layer: the
 * need is small, exactly specifiable, and testable, so a dependency would buy
 * convenience at the cost of a supply-chain surface on the request path.
 *
 * Two properties matter more than expressiveness:
 *
 *   Unknown keys are rejected, not ignored. A body carrying `role: "ADMIN"`
 *   next to the fields a form sends is a parameter-tampering attempt (§53),
 *   and silently dropping it hides the attempt from the audit log. Refusing it
 *   makes the attempt visible and the contract exact.
 *
 *   Every failure is collected. A caller fixing a form should see all four
 *   problems at once, not one per round trip.
 */

import type { FieldProblem } from './problem'

export type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string }

export interface Field<T> {
  check: (raw: unknown) => FieldResult<T>
  /** Absent input is acceptable and yields this value. */
  readonly optional?: boolean
}

export type Shape = Record<string, Field<unknown>>

/** The object a shape produces, with each field's parsed type. */
export type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Field<infer T> ? T : never }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problems: FieldProblem[] }

// ------------------------------------------------------------------ fields

export interface StringOptions {
  min?: number
  max: number
  /** Strip surrounding whitespace before every other check. */
  trim?: boolean
  pattern?: RegExp
  /** Description used in the message when `pattern` rejects. */
  patternHint?: string
}

export function string(options: StringOptions): Field<string> {
  return {
    check: (raw) => {
      if (typeof raw !== 'string') return { ok: false, message: 'must be text' }

      const value = options.trim === true ? raw.trim() : raw

      // Length is measured in UTF-8 bytes, not code units. A column sized in
      // bytes and a check counting characters disagree the moment someone
      // sends anything outside the basic plane, and the database wins that
      // disagreement at 500 rather than 400.
      const bytes = Buffer.byteLength(value, 'utf8')
      const min = options.min ?? 0

      if (bytes < min) {
        return { ok: false, message: `must be at least ${min.toString()} bytes` }
      }
      if (bytes > options.max) {
        return { ok: false, message: `must be at most ${options.max.toString()} bytes` }
      }
      if (options.pattern !== undefined && !options.pattern.test(value)) {
        return { ok: false, message: options.patternHint ?? 'is not in the expected format' }
      }

      return { ok: true, value }
    },
  }
}

/**
 * An email address, normalised to lower case.
 *
 * The check is deliberately loose. RFC 5322 permits addresses that no
 * validator in production accepts, and a strict regex mostly rejects valid
 * mail. Deliverability is proven by sending a verification token, not by
 * pattern-matching; this only rejects input that cannot be an address at all,
 * and normalises case so that the `email = lower(email)` constraint in
 * migration 0001 is satisfied rather than violated at insert time.
 */
export function email(): Field<string> {
  return {
    check: (raw) => {
      if (typeof raw !== 'string') return { ok: false, message: 'must be text' }

      const value = raw.trim().toLowerCase()
      if (Buffer.byteLength(value, 'utf8') > 320) {
        return { ok: false, message: 'is too long to be an email address' }
      }

      const at = value.indexOf('@')
      const looksLikeAddress =
        at > 0 && at === value.lastIndexOf('@') && at < value.length - 1 && !/\s/.test(value)

      if (!looksLikeAddress) return { ok: false, message: 'is not an email address' }

      return { ok: true, value }
    },
  }
}

/** An integer within bounds. Accepts a numeric string, which is what a query param is. */
export function integer(options: { min: number; max: number }): Field<number> {
  return {
    check: (raw) => {
      const value = typeof raw === 'string' ? Number(raw) : raw

      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { ok: false, message: 'must be a whole number' }
      }
      if (value < options.min || value > options.max) {
        return {
          ok: false,
          message: `must be between ${options.min.toString()} and ${options.max.toString()}`,
        }
      }

      return { ok: true, value }
    },
  }
}

/** A slug, matching the CHECK constraint migration 0001 puts on every slug column. */
export function slug(): Field<string> {
  return string({
    min: 1,
    max: 128,
    trim: true,
    pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
    patternHint: 'must be lower-case words separated by single hyphens',
  })
}

/** A boolean, accepting the "true"/"false" strings a query param carries. */
export function boolean(): Field<boolean> {
  return {
    check: (raw) => {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (raw === 'true') return { ok: true, value: true }
      if (raw === 'false') return { ok: true, value: false }
      return { ok: false, message: 'must be true or false' }
    },
  }
}

/** Wraps a field so that an absent value is acceptable. */
export function optional<T>(field: Field<T>): Field<T | undefined> {
  return {
    optional: true,
    check: (raw) => {
      if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
      return field.check(raw)
    },
  }
}

// ------------------------------------------------------------------ object

/**
 * Validates a whole object against a shape.
 *
 * Rejects unknown keys. See the module comment: this is the parameter
 * tampering defence, and it only works if it is the default.
 */
export function parse<S extends Shape>(shape: S, raw: unknown): ParseResult<Infer<S>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: [{ field: '', message: 'body must be a JSON object' }] }
  }

  const input = raw as Record<string, unknown>
  const problems: FieldProblem[] = []
  const output: Record<string, unknown> = {}

  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(shape, key)) {
      problems.push({ field: key, message: 'is not a field this endpoint accepts' })
    }
  }

  for (const [key, field] of Object.entries(shape)) {
    const present = Object.hasOwn(input, key)

    if (!present) {
      if (field.optional === true) {
        output[key] = undefined
        continue
      }
      problems.push({ field: key, message: 'is required' })
      continue
    }

    const result = field.check(input[key])
    if (result.ok) {
      output[key] = result.value
    } else {
      problems.push({ field: key, message: result.message })
    }
  }

  if (problems.length > 0) return { ok: false, problems }

  return { ok: true, value: output as Infer<S> }
}

/** Query strings are flat string maps; the same shapes validate them. */
export function fromSearchParams(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of params.entries()) out[key] = value
  return out
}
