/**
 * /admin -- the command centre, built only from counts the database produced.
 *
 * §89 bans fake dashboards, and this is the page the rule exists for. Every
 * tile below is a real count. The surfaces with no tables behind them --
 * advertising, surveys, rewards, fraud -- are listed as unbuilt rather than
 * rendered with a zero, because a zero and "does not exist" look identical on
 * a screen and mean entirely different things to whoever is reading it.
 */

import Link from 'next/link'
import { Refusal } from '@/components/desk/Gate'
import { guard } from '@/lib/auth/guard'
import { can } from '@/lib/auth/rbac'
import { db } from '@/lib/db/pool'
import { listAccounts, platformSummary, recentAudit } from '@/lib/db/newsroom'

export const metadata = { title: 'Admin · My News Factory' }
export const dynamic = 'force-dynamic'

/** Named so nobody has to guess what an unbuilt surface is waiting on. */
const UNBUILT = [
  ['Advertising', 'no advertisers, campaigns or creatives tables (Phase 7)'],
  ['Surveys and polls', 'no surveys or responses tables (Phase 6)'],
  ['Rewards and wallets', 'no wallet or ledger tables (Phase 8)'],
  ['Fraud and abuse', 'no signals pipeline (Phase 9)'],
  ['KYC', 'schema only; no document storage or review queue'],
]

export default async function AdminPage() {
  const outcome = await guard('users.read', '/admin')
  if (outcome.state !== 'ALLOWED') return <Refusal outcome={outcome} surface="Admin command centre" />

  const { viewer } = outcome
  const mayReadAudit = can(viewer.grants, 'audit.read')

  let summary = {
    users: 0, reporters: 0, published: 0, unpublished: 0,
    liveSessions: 0, auditEvents: 0, failedSignInsToday: 0,
  }
  let accounts: Awaited<ReturnType<typeof listAccounts>> = []
  let audit: Awaited<ReturnType<typeof recentAudit>> = []
  let reachable = true

  try {
    const handle = db()
    ;[summary, accounts] = await Promise.all([platformSummary(handle), listAccounts(handle)])
    // Reading the audit log is its own permission: an administrator who can
    // see accounts is not automatically entitled to see who did what (§6).
    if (mayReadAudit) audit = await recentAudit(handle)
  } catch (error) {
    reachable = false
    console.error('[admin] read failed', {
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  const tiles: [string, number][] = [
    ['Accounts', summary.users],
    ['Reporter profiles', summary.reporters],
    ['Published stories', summary.published],
    ['Unpublished stories', summary.unpublished],
    ['Live sessions', summary.liveSessions],
    ['Audit events', summary.auditEvents],
    ['Failed sign-ins, 24h', summary.failedSignInsToday],
  ]

  return (
    <div className="shell portal">
      <div className="pagehead">
        <p className="lbl">Admin</p>
        <h1>Command centre</h1>
        <p>Every figure here is a count this page read from the database a moment ago.</p>
      </div>

      {!reachable && (
        <p className="authnote authnote--bad">
          The database did not answer. The figures below are zeroes because nothing was read, not
          because the platform is empty.
        </p>
      )}

      <div className="dashgrid">
        {tiles.map(([label, value]) => (
          <section className="col-mod" key={label}>
            <h2 className="rule-head">{label}</h2>
            <p className="bignum">{value.toLocaleString('en')}</p>
          </section>
        ))}
      </div>

      <section className="band">
        <h2 className="rule-head">Accounts</h2>
        {accounts.length === 0 ? (
          <p className="empty">No accounts.</p>
        ) : (
          <table className="desktable">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Roles</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <th scope="row">{account.email}</th>
                  <td>{account.displayName}</td>
                  <td>{account.status}</td>
                  <td>
                    {account.roles.length === 0
                      ? <span className="meta">none</span>
                      : account.roles.join(', ')}
                  </td>
                  <td className="num">{account.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="meta">
          Read-only. Granting and revoking roles, and suspending an account, need endpoints that do
          not exist yet — so there are no buttons here rather than buttons that do nothing.
        </p>
      </section>

      {mayReadAudit && (
        <section className="band">
          <h2 className="rule-head">Recent audit events</h2>
          {audit.length === 0 ? (
            <p className="empty">Nothing recorded yet.</p>
          ) : (
            <table className="desktable">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Actor</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry, index) => (
                  <tr key={`${entry.createdAt}-${index.toString()}`}>
                    <td className="num">{entry.createdAt.slice(0, 19).replace('T', ' ')}</td>
                    <td>{entry.action}</td>
                    <td>{entry.resourceType}/{entry.resourceId}</td>
                    <td>{entry.actorEmail ?? <span className="meta">system</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="band">
        <h2 className="rule-head">Not built yet</h2>
        <ul className="duty">
          {UNBUILT.map(([title, waiting]) => (
            <li key={title}><strong>{title}</strong> — {waiting}</li>
          ))}
        </ul>
        <p><Link href="/dashboard">Back to your account</Link></p>
      </section>
    </div>
  )
}
