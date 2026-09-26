/**
 * /editorial -- the queue, and the buttons that move it (§12, §43).
 *
 * Which buttons appear is decided from live grants, so an editor who may
 * review but not publish does not see a publish button. That is presentation,
 * not protection: the endpoints re-check every one of these, and would refuse
 * the request if the button were put back by hand.
 */

import Link from 'next/link'
import StoryTable from '@/components/desk/StoryTable'
import TransitionButtons from '@/components/desk/TransitionButtons'
import { Refusal } from '@/components/desk/Gate'
import { guard } from '@/lib/auth/guard'
import { can } from '@/lib/auth/rbac'
import { db } from '@/lib/db/pool'
import { listQueue, statusCounts } from '@/lib/db/newsroom'

export const metadata = { title: 'Editorial desk · My News Factory' }
export const dynamic = 'force-dynamic'

export default async function EditorialPage() {
  const outcome = await guard('news.review', '/editorial')
  if (outcome.state !== 'ALLOWED') return <Refusal outcome={outcome} surface="Editorial desk" />

  const { viewer } = outcome
  const canPublish = can(viewer.grants, 'news.publish')
  const canUnpublish = can(viewer.grants, 'news.unpublish')

  let queue: Awaited<ReturnType<typeof listQueue>> = []
  let counts: Awaited<ReturnType<typeof statusCounts>> = []
  let reachable = true

  try {
    const handle = db()
    ;[queue, counts] = await Promise.all([listQueue(handle), statusCounts(handle)])
  } catch (error) {
    reachable = false
    console.error('[editorial] read failed', {
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return (
    <div className="shell portal">
      <div className="pagehead">
        <p className="lbl">Editorial desk</p>
        <h1>Queue</h1>
        <p>
          Everything not yet published, oldest change first — the order the desk should work it in.
        </p>
      </div>

      {!reachable && (
        <p className="authnote authnote--bad">
          The newsroom database did not answer. The queue below is not current.
        </p>
      )}

      <section className="band">
        <h2 className="rule-head">By status</h2>
        {counts.length === 0 ? (
          <p className="empty">No stories at all.</p>
        ) : (
          <ul className="chips">
            {counts.map((entry) => (
              <li className="chip" key={entry.status}>
                {entry.status.replace(/_/g, ' ')} · {entry.count.toLocaleString('en')}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="band">
        <h2 className="rule-head">Awaiting a decision</h2>
        <StoryTable
          stories={queue}
          showReporter
          empty="Nothing waiting. Every story is published."
          action={(story) => (
            <TransitionButtons
              slug={story.slug}
              status={story.status}
              canPublish={canPublish}
              canUnpublish={canUnpublish}
              canReview
            />
          )}
        />
      </section>

      <section className="band">
        <h2 className="rule-head">Not built yet</h2>
        <p className="meta">
          Assignment to a named editor, SLA timers and the AI review stage all need tables or
          services that do not exist. The status vocabulary already includes AI_REVIEW because the
          schema does; nothing writes it yet.
        </p>
        <p><Link href="/dashboard">Back to your account</Link></p>
      </section>
    </div>
  )
}
