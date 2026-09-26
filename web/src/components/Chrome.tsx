import Link from 'next/link'
import Clock from './Clock'
import SignOutButton from './auth/SignOutButton'
import { currentViewer } from '@/lib/auth/session-server'
import { getCategories } from '@/lib/content'
import { money, pricing } from '@/lib/pricing'

/**
 * The utility bar.
 *
 * This showed a signed-in "Rahul Sharma · Premium member" and an alert count
 * of five to every visitor, signed in or not. That is the fake UI the
 * specification prohibits: it described a state the system could not be in,
 * and it would have gone on describing it after real accounts existed.
 *
 * It now reads the session. An anonymous reader is offered sign-in; a signed-in
 * one sees their own name. The locale and currency controls are still inert
 * and are marked as such rather than left looking operable -- §71 and §72 give
 * them a phase, and a select that silently does nothing is the same lie in a
 * smaller font.
 */
/** The role surfaces, most privileged last so they read left to right. */
const DESKS = [
  { permission: 'news.submit', href: '/desk', label: 'Desk' },
  { permission: 'news.review', href: '/editorial', label: 'Editorial' },
  { permission: 'users.read', href: '/admin', label: 'Admin' },
]

export async function TopBar() {
  const viewer = await currentViewer()

  return (
    <div className="utility">
      <div className="shell">
        <ul className="lbl">
          <li><span aria-disabled="true" title="Region selection arrives with §72">Global</span></li>
          <li><span aria-disabled="true" title="Languages arrive with §71">EN</span></li>
          <li><span aria-disabled="true" title="Currencies arrive with §72">INR ₹</span></li>
        </ul>
        <div className="who lbl">
          {viewer === null ? (
            <>
              <Link href="/login">Sign in</Link>
              <Link href="/register">Create account</Link>
            </>
          ) : (
            <>
              {/* Offered from live permissions, so a revoked role stops being
                  offered on the next request. The desks re-check anyway --
                  showing a link decides nothing. */}
              {DESKS.filter((desk) => viewer.permissions.includes(desk.permission)).map((desk) => (
                <Link href={desk.href} key={desk.href}>{desk.label}</Link>
              ))}
              <Link href="/dashboard">{viewer.displayName}</Link>
              <SignOutButton className="linkbtn" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function Masthead() {
  return (
    <header className="masthead">
      <div className="shell">
        <div className="brand">
          <h1><Link href="/">MY NEWS FACTORY</Link></h1>
          <div className="tag lbl">People-powered global news · media · research · rewards</div>
        </div>

        <Clock />

        <div className="mast-actions">
          <form className="searchbox" role="search" action="/search">
            <span className="meta" aria-hidden="true">⌕</span>
            <label className="skip" htmlFor="q">Search</label>
            <input id="q" name="q" type="search" placeholder="Search news, cities, reporters" />
          </form>
          <div className="mast-btns">
            {/* Both pointed at anchors that did not exist. Reporter submission
                and the academy are Phase 3; until then the honest destination
                for both is the account that either one starts from. */}
            <Link className="btn btn--red" href="/register">Report now</Link>
            <Link className="btn" href="/register">Become a reporter</Link>
          </div>
        </div>
      </div>
    </header>
  )
}

export async function MainNav() {
  const categories = await getCategories()
  return (
    <nav className="mainnav" aria-label="Sections">
      <div className="shell">
        <ul>
          {categories.map((c, i) => (
            <li key={c.slug} className={i === 0 ? 'first' : undefined}>
              <Link href={`/category/${c.slug}`}>{c.name}</Link>
            </li>
          ))}
          <li><Link href="/category/breaking">More ▾</Link></li>
        </ul>
        <div className="book">
          <a className="b1" href="#advertise">Advertise</a>
          <a className="b2" href="#interview">Book interview</a>
          <a className="b3" href="#story">Book story</a>
        </div>
      </div>
    </nav>
  )
}

export function Ticker({ headlines }: { headlines: string[] }) {
  // Duplicated so the marquee can loop seamlessly at -50%.
  const run = [...headlines, ...headlines]
  return (
    <div className="ticker">
      <div className="shell">
        <span className="tag badge live">Live</span>
        <div className="track">
          <div className="run">
            {run.map((h, i) => (
              <span key={i}>{h}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SiteFooter() {
  return (
    <footer className="sitefoot">
      <div className="shell">
        <div className="top">
          <div>
            <h3>MY NEWS FACTORY</h3>
            <p className="strap">
              The world’s people-powered global news, media, research, advertising &amp; rewards network.
            </p>
            <form className="news" action="/subscribe">
              <label className="skip" htmlFor="email">Email address</label>
              <input id="email" name="email" type="email" placeholder="Your email" required />
              <button type="submit">Subscribe</button>
            </form>
          </div>
          <div>
            <div className="lbl" style={{ color: 'var(--ink4)', marginBottom: 12 }}>Participate</div>
            <ul>
              <li><a href="#become">Become a reporter — {money(pricing.reporterTrainingFee)}</a></li>
              <li><a href="#advertise">Advertise with us</a></li>
              <li><a href="#interview">Book an interview</a></li>
              <li><a href="#story">Book a success story</a></li>
              <li><a href="#surveys">Surveys &amp; polls</a></li>
            </ul>
          </div>
          <div>
            <div className="lbl" style={{ color: 'var(--ink4)', marginBottom: 12 }}>Company</div>
            <ul>
              <li><a href="#about">About</a></li>
              <li><a href="#terms">Terms</a></li>
              <li><a href="#privacy">Privacy</a></li>
              <li><a href="#cookies">Cookies</a></li>
              <li><a href="#contact">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="bottom lbl">
          <span>More stories · more people · a bigger world</span>
          <span>© {new Date().getFullYear()} My News Factory</span>
        </div>
      </div>
    </footer>
  )
}
