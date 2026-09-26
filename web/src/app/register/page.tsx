/**
 * /register (§6).
 *
 * Every account starts as a reader. Reporter, editor and advertiser access are
 * grants added afterwards, never something a registration form can request --
 * the API rejects a body that tries (D-017), and this form gives it no way to.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import RegisterForm from '@/components/auth/RegisterForm'
import { currentViewer } from '@/lib/auth/session-server'

export const metadata = { title: 'Create an account · My News Factory' }
export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  if ((await currentViewer()) !== null) redirect('/dashboard')

  return (
    <div className="authpage">
      <div className="authcard">
        <div className="pagehead">
          <p className="lbl">Account</p>
          <h1>Create an account</h1>
        </div>

        <RegisterForm />

        <p className="authalt">
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </div>

      <aside className="authaside">
        <h2 className="lbl">How your details are held</h2>
        <ul className="duty">
          <li>Passwords are hashed with Argon2id and never stored readably</li>
          <li>Session tokens are stored only as digests</li>
          <li>Your address is kept for sign-in; the security log holds only a keyed hash of it</li>
          <li>You can sign out of every device at once</li>
        </ul>
        <p className="meta">See docs/AUTHENTICATION.md in the repository for the detail.</p>
      </aside>
    </div>
  )
}
