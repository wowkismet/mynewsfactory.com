'use client'

/**
 * The editor's act buttons.
 *
 * These decide nothing. Each posts to an endpoint that re-checks the
 * permission, the second factor and the origin before it touches a row -- so
 * rendering a button is a statement about what is worth offering, never about
 * what is allowed. A 403 here is the system working.
 *
 * Failures are shown on the row that failed rather than as a page-level
 * banner: an editor working a queue needs to know which story did not move.
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { post } from '@/components/auth/api-client'

const REVIEW_STEPS = [
  { to: 'EDITOR_REVIEW', label: 'To review' },
  { to: 'FACT_CHECK', label: 'Fact check' },
  { to: 'APPROVED', label: 'Approve' },
  { to: 'CORRECTION_REQUIRED', label: 'Send back' },
  { to: 'REJECTED', label: 'Reject' },
] as const

export default function TransitionButtons({
  slug,
  status,
  canPublish,
  canUnpublish,
  canReview,
}: {
  slug: string
  status: string
  canPublish: boolean
  canUnpublish: boolean
  canReview: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(path: string, body: unknown, label: string): Promise<void> {
    setBusy(label)
    setError(null)
    const result = await post(`/api/v1/news/${slug}${path}`, body)
    setBusy(null)
    if (!result.ok) { setError(result.message); return }
    router.refresh()
  }

  const steps = REVIEW_STEPS.filter((step) => step.to !== status)

  return (
    <div className="rowactions">
      {canPublish && status !== 'PUBLISHED' && (
        <button
          type="button"
          className="btn btn--red"
          disabled={busy !== null}
          onClick={() => void act('/publish', {}, 'publish')}
        >
          {busy === 'publish' ? 'Publishing…' : 'Publish'}
        </button>
      )}

      {canUnpublish && status === 'PUBLISHED' && (
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void act('/unpublish', {}, 'unpublish')}
        >
          {busy === 'unpublish' ? 'Withdrawing…' : 'Withdraw'}
        </button>
      )}

      {canReview && status !== 'PUBLISHED' && (
        <select
          className="rowselect"
          disabled={busy !== null}
          value=""
          aria-label={`Move ${slug} to another review status`}
          onChange={(e) => {
            const to = e.target.value
            if (to !== '') void act('/review', { to }, to)
          }}
        >
          <option value="">Move to…</option>
          {steps.map((step) => (
            <option key={step.to} value={step.to}>{step.label}</option>
          ))}
        </select>
      )}

      {error !== null && <span className="fielderr">{error}</span>}
    </div>
  )
}
