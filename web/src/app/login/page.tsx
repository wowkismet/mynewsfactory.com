/**
 * /login (§5).
 *
 * The destination is validated on the server, before it reaches the client:
 * `safeNext` in lib/auth/redirect.ts says why, and is shared with the security
 * page a privileged account is routed through on the way.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import SignInForm from '@/components/auth/SignInForm'
import { currentViewer } from '@/lib/auth/session-server'
import { nextFrom } from '@/lib/auth/redirect'

export const metadata = { title: 'Sign in · My News Factory' }
export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const viewer = await currentViewer()
  const params = await searchParams

  const next = nextFrom(params)

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
