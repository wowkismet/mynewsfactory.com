/**
 * A desk listing.
 *
 * Shared by the reporter desk and the editorial queue so the two agree on what
 * a story looks like: same columns, same status vocabulary, same dates. Two
 * tables drifting apart is how a reporter and their editor end up describing
 * the same row differently.
 */

import Link from 'next/link'
import type { DeskStory } from '@/lib/db/newsroom'

function when(iso: string): string {
  if (iso === '') return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip status status--${status.toLowerCase()}`}>{status.replace(/_/g, ' ')}</span>
}

export default function StoryTable({
  stories,
  empty,
  showReporter = false,
  action,
}: {
  stories: DeskStory[]
  empty: string
  showReporter?: boolean
  /** Rendered in a trailing cell, for desks that can act on a row. */
  action?: (story: DeskStory) => React.ReactNode
}) {
  if (stories.length === 0) return <p className="empty">{empty}</p>

  return (
    <table className="desktable">
      <thead>
        <tr>
          <th scope="col">Story</th>
          <th scope="col">Status</th>
          {showReporter && <th scope="col">Reporter</th>}
          <th scope="col">Updated</th>
          <th scope="col">Views</th>
          {action !== undefined && <th scope="col">Action</th>}
        </tr>
      </thead>
      <tbody>
        {stories.map((story) => (
          <tr key={story.slug}>
            <th scope="row">
              {story.status === 'PUBLISHED'
                ? <Link href={`/news/${story.slug}`}>{story.title}</Link>
                : story.title}
              <span className="meta"> · {story.categorySlug}{story.citySlug === null ? '' : ` · ${story.citySlug}`}</span>
            </th>
            <td><StatusChip status={story.status} /></td>
            {showReporter && <td>{story.reporterName}</td>}
            <td className="num">{when(story.updatedAt)}</td>
            <td className="num">{story.views.toLocaleString('en')}</td>
            {action !== undefined && <td>{action(story)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
