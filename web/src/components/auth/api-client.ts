/**
 * Talking to `/api/v1` from the browser (§83).
 *
 * The API answers in exactly one envelope, so exactly one function unwraps it.
 * Without this, every form would re-derive "did it work, and if not what do I
 * show" -- and would get the field-level case wrong in a different way each
 * time.
 */

export interface FieldProblem {
  field: string
  message: string
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fields: FieldProblem[] }

interface Envelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; requestId: string; fields?: FieldProblem[] }
}

export async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  let response: Response

  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // The session cookies are the point of the call.
      credentials: 'same-origin',
    })
  } catch {
    // A network failure is not an API failure and must not be reported as one:
    // the request may never have reached the server.
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
      fields: [],
    }
  }

  let envelope: Envelope<T>
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'The server sent a response we could not read.',
      fields: [],
    }
  }

  if (envelope.success && envelope.data !== undefined) {
    return { ok: true, data: envelope.data }
  }

  return {
    ok: false,
    code: envelope.error?.code ?? 'INTERNAL_ERROR',
    message: envelope.error?.message ?? 'Something went wrong.',
    fields: envelope.error?.fields ?? [],
  }
}

/** The message for one field, if the server rejected it. */
export function fieldError(fields: FieldProblem[], name: string): string | undefined {
  return fields.find((problem) => problem.field === name)?.message
}
