/**
 * /desk -- the reporter's own work (§12, §42).
 *
 * Their stories and three totals, all read from the database. No earnings
 * tile: there is no ledger yet, and a reward figure with nothing behind it is
 * the §89 failure in its most tempting form -- the number a reporter would
 * most want to see is the one it would be easiest to invent.
 */

import Link from 'next/link'
import StoryTable from '@/components/desk/StoryTable'
import { Refusal } from '@/components/desk/Gate'
import { guard } from '@/lib/auth/guard'
import { db } from '@/lib/db/pool'
import { listForReporter, reporterForUser, reporterTotals } from '@/lib/db/newsroom'

export const metadata = { title: 'Reporter desk · My News Factory' }
export const dynamic = 'force-dynamic'

export default async function DeskPage() {
  const outcome = await guard('news.submit', '/desk')
  if (outcome.state !== 'ALLOWED') return <Refusal outcome={outcome} surface="Reporter desk" />

  const { viewer } = outcome

  let profile = null
  let stories: Awaited<ReturnType<typeof listForReporter>> = []
  let totals = { published: 0, open: 0, views: 0 }
  let reachable = true

  try {
    const handle = db()
    profile = await reporterForUser(handle, viewer.userId)
    if (profile !== null) {
      ;[stories, totals] = await Promise.all([
        listForReporter(handle, profile.id),
        reporterTotals(handle, profile.id),
      ])
    }
  } catch (error) {
    reachable = false
    console.error('[desk] read failed', {
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return (
    <div className="shell portal">
      <div className="pagehead">
        <p className="lbl">Reporter desk</p>
        <h1>{profile?.name ?? viewer.displayName}</h1>
        {profile === null ? (
          <p>
            You hold the permission to file, but no reporter profile is attached to this account
            yet. An editor creates one; until then there is nothing to list.
          </p>
        ) : (
          <p>
            {profile.tier}
            {profile.verified ? ' · verified' : ' · verification pending'}
          </p>
        )}
      </div>

      {!reachable && (
        <p className="authnote authnote--bad">
          The newsroom database did not answer. Nothing below is current — this is an error, not an
          empty desk.
        </p>
      )}

      <div className="dashgrid">
        <section className="col-mod">
          <h2 className="rule-head">Published</h2>
          <p className="bignum">{totals.published.toLocaleString('en')}</p>
        </section>
        <section className="col-mod">
          <h2 className="rule-head">In progress</h2>
          <p className="bignum">{totals.open.toLocaleString('en')}</p>
        </section>
        <section className="col-mod">
          <h2 className="rule-head">Views on published work</h2>
          <p className="bignum">{totals.views.toLocaleString('en')}</p>
        </section>
      </div>

      <section className="band">
        <h2 className="rule-head">Your stories</h2>
        <StoryTable
          stories={stories}
          empty={
            profile === null
              ? 'No reporter profile, so no stories.'
              : 'Nothing filed yet.'
          }
        />
      </section>

      <section className="band">
        <h2 className="rule-head">Not built yet</h2>
        <p className="meta">
          Filing a story from the browser, assignments, and earnings all need tables that do not
          exist yet. They are named here rather than shown as empty panels, because an empty panel
          and an unbuilt one look identical and mean different things.
        </p>
        <ul className="duty">
          <li><strong>Submit a story</strong> — the editor can move what exists; there is no compose surface</li>
          <li><strong>Assignments</strong> — no assignments table (Phase 5)</li>
          <li><strong>Earnings</strong> — no wallet or ledger (Phase 8)</li>
        </ul>
        <p><Link href="/dashboard">Back to your account</Link></p>
      </section>
    </div>
  )
}
