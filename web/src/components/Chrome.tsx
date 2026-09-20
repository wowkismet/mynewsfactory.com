import Link from 'next/link'
import Clock from './Clock'
import { getCategories } from '@/lib/content'
import { money, pricing } from '@/lib/pricing'

export function TopBar() {
  return (
    <div className="utility">
      <div className="shell">
        <ul className="lbl">
          <li><a href="#">Global ▾</a></li>
          <li><a href="#">EN ▾</a></li>
          <li><a href="#">INR ₹ ▾</a></li>
          <li><span className="alerts">Alerts<span className="count">5</span></span></li>
        </ul>
        <div className="who lbl">
          <span>Rahul Sharma</span>
          <span className="prem">Premium member</span>
          <a href="#">Log in</a>
          <a href="#">Sign up</a>
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
            <a className="btn btn--red" href="#report">Report now</a>
            <a className="btn" href="#become">Become a reporter</a>
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
