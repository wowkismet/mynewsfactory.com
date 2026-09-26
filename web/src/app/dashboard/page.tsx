/**
 * /dashboard (§31, §89).
 *
 * This page shows what is real and says plainly what is not.
 *
 * The specification bans fake dashboards and mock data presented as production
 * data, and a dashboard is where that rule is hardest to keep: the shape of
 * the thing invites tiles, and tiles invite numbers. So every figure here is
 * read from the database or derived from the session, and the surfaces that
 * have no data behind them yet are listed as not built rather than rendered
 * with a plausible zero. A zero and "not built" look identical on a screen and
 * mean completely different things to whoever is reading it.
 *
 * Which panels appear is decided by permission, never by role name (§6).
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import SignOutButton from '@/components/auth/SignOutButton'
import { currentViewer, homeSurface } from '@/lib/auth/session-server'

export const metadata = { title: 'Your account · My News Factory' }
export const dynamic = 'force-dynamic'

/** Surfaces the specification calls for, and the phase each one waits on. */
const PLANNED: { permission: string; title: string; waiting: string }[] = [
  { permission: 'news.submit', title: 'Reporter desk', waiting: 'Phase 3 — submissions, assignments, earnings' },
  { permission: 'news.review', title: 'Editorial queue', waiting: 'Phase 2 — assignment, SLA timers, review' },
  { permission: 'ads.manage_own', title: 'Campaigns', waiting: 'Phase 7 — creatives, budget, analytics' },
  { permission: 'surveys.create', title: 'Surveys and polls', waiting: 'Phase 6 — authoring, boost, validation' },
  { permission: 'finance.read', title: 'Finance', waiting: 'Phase 8 — ledger, payouts, revenue split' },
  { permission: 'users.suspend', title: 'Admin command centre', waiting: 'Phase 1 onward — users, roles, audit' },
]

export default async function DashboardPage() {
  const viewer = await currentViewer()
  if (viewer === null) redirect('/login?next=%2Fdashboard')

  const surface = homeSurface(viewer.permissions)
  const planned = PLANNED.filter((entry) => viewer.permissions.includes(entry.permission))

  return (
    <div className="portal">
      <div className="pagehead">
        <p className="lbl">{surface.label}</p>
        <h1>{viewer.displayName}</h1>
      </div>

      <div className="dashgrid">
        <section className="col-mod">
          <h2 className="rule-head">Account</h2>
          <dl className="factlist">
            <dt>Name</dt>
            <dd>{viewer.displayName}</dd>
            <dt>Email</dt>
            <dd>{viewer.email}</dd>
            <dt>Status</dt>
            <dd>
              {viewer.status}
              {viewer.status === 'PENDING' && (
                <span className="meta"> — email not verified yet</span>
              )}
            </dd>
            <dt>Two-factor</dt>
            <dd>
              {viewer.mfaRequired
                ? viewer.mfaSatisfied
                  ? 'Required, satisfied'
                  : 'Required, not satisfied'
                : 'Not required for this account'}
            </dd>
          </dl>

          <div className="dashactions">
            <SignOutButton className="btn" />
          </div>
        </section>

        <section className="col-mod">
          <h2 className="rule-head">What you may do</h2>
          <p className="meta">
            Read from your live grants. Revoking a role takes effect on your next request.
          </p>
          <ul className="chips">
            {viewer.permissions.map((permission) => (
              <li className="chip" key={permission}>
                {permission}
              </li>
            ))}
          </ul>
          {viewer.grants.some((grant) => grant.scope !== 'GLOBAL') && (
            <>
              <h3 className="lbl">Scoped to</h3>
              <ul className="duty">
                {viewer.grants
                  .filter((grant) => grant.scope !== 'GLOBAL')
                  .map((grant) => (
                    <li key={`${grant.permission}-${grant.scope}-${grant.countryCode ?? grant.cityId ?? ''}`}>
                      {grant.permission} — {grant.scope.toLowerCase()}{' '}
                      {grant.countryCode ?? grant.cityId ?? ''}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>

        <section className="col-mod">
          <h2 className="rule-head">Reading</h2>
          <p className="meta">
            Following, bookmarks and reading history are Phase 2. Nothing is recorded against your
            account yet, so there is no history to show — this is an absence, not an empty state.
          </p>
          <p>
            <Link href="/">Browse the front page</Link>
          </p>
        </section>

        {planned.length > 0 && (
          <section className="col-mod dashwide">
            <h2 className="rule-head">Your surfaces, once they exist</h2>
            <p className="meta">
              You hold the permissions for these. The pages behind them are not built, and are
              listed here rather than linked to something empty.
            </p>
            <ul className="duty">
              {planned.map((entry) => (
                <li key={entry.permission}>
                  <strong>{entry.title}</strong> — {entry.waiting}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
