/**
 * /login (§5).
 *
 * The `next` parameter is the interesting part. A sign-in page that redirects
 * wherever a query string says is an open redirect: an attacker sends
 * `/login?next=https://evil.example/mynewsfactory`, the victim signs in on the
 * real site, and lands on a copy that asks them to "confirm" their password.
 * The link looked legitimate because it was.
 *
 * So the destination is validated here, on the server, before it reaches the
 * client: it must be a path on this site. Anything else -- an absolute URL, a
 * protocol-relative `//host`, a backslash form some parsers normalise into
 * one -- falls back to the dashboard.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import SignInForm from '@/components/auth/SignInForm'
import { currentViewer } from '@/lib/auth/session-server'

export const metadata = { title: 'Sign in · My News Factory' }
export const dynamic = 'force-dynamic'

const DEFAULT_NEXT = '/dashboard'

export function safeNext(raw: string | undefined): string {
  if (raw === undefined || raw === '') return DEFAULT_NEXT

  // Must be a site-relative path. `//evil.example` and `/\evil.example` are
  // both read as authority by at least one browser, so neither counts.
  if (!raw.startsWith('/')) return DEFAULT_NEXT
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_NEXT
  if (raw.includes('://')) return DEFAULT_NEXT

  return raw
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const viewer = await currentViewer()
  const params = await searchParams

  const rawNext = params.next
  const next = safeNext(typeof rawNext === 'string' ? rawNext : undefined)

  if (viewer !== null) redirect(next)

  return (
    <div className="authpage">
      <div className="authcard">
        <div className="pagehead">
          <p className="lbl">Account</p>
          <h1>Sign in</h1>
        </div>

        <SignInForm next={next} />

        <p className="authalt">
          No account yet? <Link href="/register">Create one</Link>
        </p>
      </div>

      <aside className="authaside">
        <h2 className="lbl">What an account gives you</h2>
        <ul className="duty">
          <li>Follow cities, topics and reporters</li>
          <li>Save stories and pick up where you left off</li>
          <li>Take part in polls and surveys</li>
          <li>Earn and track reward coins</li>
        </ul>
        <p className="meta">
          Reporter, editor and advertiser access is granted on top of a reader account.
        </p>
      </aside>
    </div>
  )
}
