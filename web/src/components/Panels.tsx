import Link from 'next/link'
import { getArticles, getCategories, getCities, getReporter } from '@/lib/content'
import { money, moneyRange, pricing } from '@/lib/pricing'
import { platformSummary } from '@/lib/db/newsroom'
import { db } from '@/lib/db/pool'
import { Artwork } from './Artwork'
import { timeAgo, views } from './Story'

/**
 * The portal sidebar from the 4.0 design.
 *
 * `note` used to carry invented counts -- "12" polls, "8 paid" surveys, an
 * "On air" channel. None of those tables exists, so the numbers were decoration
 * that read as fact. A section with nothing behind it now says "soon" and links
 * to nothing, because a link to an anchor that is not on the page is a dead end
 * dressed up as navigation.
 */
interface SideLink {
  label: string
  /** Omitted while the section has no page to go to. */
  href?: string
}

const SIDE_LINKS: SideLink[] = [
  { label: 'Home', href: '/' },
  { label: 'News', href: '/category/breaking' },
  { label: 'Breaking', href: '/category/breaking' },
  { label: 'My City', href: '/city/mumbai' },
  { label: 'Search', href: '/search' },
  { label: 'Live TV' },
  { label: 'Videos' },
  { label: 'Polls' },
  { label: 'Surveys' },
  { label: 'Interviews' },
  { label: 'Success Stories' },
  { label: 'Biographies' },
  { label: 'Rewards' },
  { label: 'Wallet' },
]

/** What a person can actually start doing, and what they cannot yet. */
const SERVICES: SideLink[] = [
  { label: 'Report now', href: '/desk' },
  { label: 'Become a reporter', href: '/register' },
  { label: 'Your account', href: '/dashboard' },
  { label: 'Book an interview' },
  { label: 'Book a story' },
  { label: 'Book a biography' },
  { label: 'Post an assignment' },
]

export function SideNav({ current = '/' }: { current?: string }) {
  return (
    <>
      <nav className="sidenav" aria-label="Portal sections">
        <div className="navlist">
          {SIDE_LINKS.map((l) =>
            l.href === undefined ? (
              <span key={l.label} aria-disabled="true" title="Not built yet">
                <span style={{ color: 'var(--ink4)' }}>{l.label}</span>
                <span className="n">soon</span>
              </span>
            ) : (
              <Link key={l.label} href={l.href} className={l.href === current ? 'on' : undefined}>
                <span>{l.label}</span>
              </Link>
            ),
          )}
        </div>
      </nav>

      <nav className="sidenav services" aria-label="My services">
        <div className="rule-head"><h2>My services</h2></div>
        {SERVICES.map((l) =>
          l.href === undefined ? (
            <span key={l.label} aria-disabled="true" title="Not built yet">
              <span className="dot" style={{ background: 'var(--ink4)' }} aria-hidden="true" />
              <span style={{ color: 'var(--ink4)' }}>{l.label}</span>
              <span className="soon">soon</span>
            </span>
          ) : (
            <Link key={l.label} href={l.href}>
              <span className="dot" aria-hidden="true" />
              <span>{l.label}</span>
            </Link>
          ),
        )}
      </nav>
    </>
  )
}

/**
 * The left column's second module.
 *
 * The four columns used to end at very different heights -- the main column ran
 * 715px while the rails stopped between 430 and 477, leaving a band of empty
 * page across three quarters of the width. The fix is content, not a stretched
 * container: each column carries enough to reach the fold.
 */
export async function TrendingList() {
  const articles = await getArticles()
  const trending = [...articles].sort((a, b) => b.views - a.views).slice(0, 6)

  return (
    <section className="col-mod">
      <div className="lbl k">Most read today</div>
      <ol className="ranked">
        {trending.map((article, index) => (
          <li key={article.slug}>
            <span className="rank">{(index + 1).toString().padStart(2, '0')}</span>
            <Link href={`/news/${article.slug}`}>
              <span className="t">{article.title}</span>
              <span className="meta">{views(article.views)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Section index, filling the left column below the trending list. */
export async function SectionIndex() {
  const categories = await getCategories()

  return (
    <section className="band sections">
      <div className="lbl k">Browse every section</div>
      <div className="chips">
        {categories.map((c) => (
          <Link key={c.slug} className="chip" href={`/category/${c.slug}`}>{c.name}</Link>
        ))}
      </div>
    </section>
  )
}

/**
 * The Live World panel.
 *
 * The design fills it with 195+ countries, 5,482 live stories and 1.2M users
 * online. Every one of those is a number this platform does not have, and a
 * visitor cannot tell an aspiration from a measurement -- so each is counted
 * instead. They are small, and small is fine. Invented is not.
 *
 * "Users online" is live sessions: accounts with an unexpired, unrevoked
 * session right now. That is a real definition of the phrase, unlike a figure
 * chosen because it looks impressive.
 */
export async function LiveWorld() {
  let countries = 0
  let published = 0
  let online = 0
  let reachable = true

  try {
    const handle = db()
    const [summary, countryRows] = await Promise.all([
      platformSummary(handle),
      handle.query<{ n: string }>('SELECT count(*)::text AS n FROM countries WHERE active'),
    ])
    countries = Number(countryRows.rows[0]?.n ?? '0')
    published = summary.published
    online = summary.liveSessions
  } catch {
    reachable = false
  }

  return (
    <aside className="world">
      <div className="lbl k">Live world</div>
      {reachable ? (
        <div className="stats">
          <div className="stat">
            <div className="lbl k">Countries</div>
            <div className="v">{countries.toLocaleString('en')}</div>
          </div>
          <div className="stat">
            <div className="lbl k">Published stories</div>
            <div className="v">{published.toLocaleString('en')}</div>
          </div>
          <div className="stat wide">
            <div className="lbl k">Readers signed in now</div>
            <div className="v">{online.toLocaleString('en')}</div>
          </div>
        </div>
      ) : (
        <p className="meta" style={{ marginTop: 10 }}>
          The newsroom database did not answer, so there is nothing to count.
        </p>
      )}
      <p className="say">One planet. One news. One community.</p>
      <div className="ad">
        <div className="lbl k">Advertise here</div>
        <Link className="slot promo" href="#advertise">
          <Artwork seed="advertise-house-slot" category="business" ratio="4:3" alt="" />
          <span className="over">
            <span className="lbl">Reach readers in every city</span>
            <span className="cta">{moneyRange(pricing.advertisingPerDayMin, pricing.advertisingPerDayMax)} per day</span>
          </span>
        </Link>
      </div>
    </aside>
  )
}

/** Live city desks, below the Live World panel. */
export async function CityDesks() {
  const [cities, articles] = await Promise.all([getCities(), getArticles()])

  return (
    <section className="col-mod">
      <div className="lbl k">City desks</div>
      <ul className="desks">
        {cities.map((city) => {
          const count = articles.filter((a) => a.citySlug === city.slug).length
          const latest = articles.find((a) => a.citySlug === city.slug)
          return (
            <li key={city.slug}>
              <Link href={`/city/${city.slug}`}>
                <span className="t">{city.newsroom}</span>
                <span className="meta">
                  {count.toString()} live · {latest ? timeAgo(latest.publishedAt) : 'standing by'}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Marketplace() {
  return (
    <section className="band" id="advertise">
      <div className="market">
        <div>
          <div className="lbl eyebrow">The future is digital</div>
          <h3>Advertise with My News Factory</h3>
          <p>Reach millions · grow your business · create, upload, boost and track in one place.</p>
          <div className="rates">
            <div className="rate">
              {money(pricing.advertisingPerDayMin)}
              <small>per day</small>
            </div>
            <span className="arrow" aria-hidden="true">→</span>
            <div className="rate">
              {money(pricing.advertisingPerDayMax)}
              <small>premium hero</small>
            </div>
          </div>
        </div>
        <a className="btn btn--red" href="#advertise-start">Get started</a>
      </div>
    </section>
  )
}

/**
 * The Quick Poll slot.
 *
 * It used to render five options with percentages summing to 100 and a total
 * vote count, none of which came from anywhere. A poll result is a claim about
 * what people think; fabricating one is not a placeholder, it is a fake
 * finding. There are no polls, surveys or reward-coin tables, so the panel
 * holds its place and says what it is waiting for.
 */
export function QuickPoll() {
  return (
    <section className="poll" id="polls">
      <div className="rule-head" style={{ margin: '-16px -16px 0' }}>
        <h3>Quick poll</h3>
      </div>
      <div className="pending">
        <p style={{ margin: 0 }}>
          Polls, surveys and the reward coins they pay are Phase&nbsp;6.
        </p>
        <p className="why" style={{ margin: 0 }}>
          There are no poll, response or wallet tables yet. A result shown here
          before they exist would be an invented finding, not a placeholder.
        </p>
      </div>
    </section>
  )
}

/**
 * The weather slot.
 *
 * A fixed "Mumbai 28° partly cloudy" is wrong somewhere between one and four
 * times a day, and a reader has no way to know which. Weather needs a feed;
 * until there is one the panel says so.
 */
export function Weather() {
  return (
    <aside className="weather">
      <div className="lbl" style={{ opacity: 0.75 }}>My city weather</div>
      <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--ink3)', lineHeight: 1.5 }}>
        Not connected to a weather service yet.
      </p>
      <p className="meta" style={{ marginTop: 8 }}>
        A fixed temperature would be wrong most of the day.
      </p>
    </aside>
  )
}

export function ServicesStrip() {
  return (
    <section className="band" id="become">
      <div className="cards">
        <div className="card"><div className="body">
          <div className="lbl" style={{ color: 'var(--rust)' }}>Become a reporter</div>
          <h3>Join the global reporter network</h3>
          <p>Get trained · get certified · get paid. Training, KYC and your Reporter Card.</p>
          <div className="foot"><a className="btn btn--red" href="#train">Train for {money(pricing.reporterTrainingFee)}</a></div>
        </div></div>
        <div className="card" id="interview"><div className="body">
          <div className="lbl" style={{ color: 'var(--teal)' }}>Book an interview</div>
          <h3>Tell your story properly</h3>
          <p>Matched to a verified reporter in your city and language.</p>
          <div className="foot"><span className="meta">{money(pricing.interviewBooking)} + applicable taxes</span></div>
        </div></div>
        <div className="card" id="story"><div className="body">
          <div className="lbl" style={{ color: 'var(--magenta)' }}>Book a success story</div>
          <h3>Researched, written, published</h3>
          <p>From a small town to a global brand — told by a Gold reporter.</p>
          <div className="foot"><span className="meta">{money(pricing.successStoryBooking)} + applicable taxes</span></div>
        </div></div>
        <div className="card" id="surveys"><div className="body">
          <div className="lbl" style={{ color: 'var(--blue)' }}>Run a survey</div>
          <h3>Reach the right respondents</h3>
          <p>Targeted by country, city, language and audience. Pay per valid response.</p>
          <div className="foot"><span className="meta">{moneyRange(pricing.surveyPerResponseMin, pricing.surveyPerResponseMax)} per response</span></div>
        </div></div>
      </div>
    </section>
  )
}

export async function CityStrip() {
  const cities = await getCities()
  return (
    <section className="band">
      <div className="rule-head"><h2>My City — every city has a newsroom</h2></div>
      <div className="cards">
        {cities.map((c) => (
          <Link key={c.slug} className="card" href={`/city/${c.slug}`}>
            <div className="body">
              <div className="lbl" style={{ color: 'var(--cyan)' }}>{c.country}</div>
              <h3>{c.newsroom}</h3>
              <p>{c.state}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

/** Reporters currently filing, below the city desks. */
export async function ReportersOnDuty() {
  const articles = await getArticles()
  // Most recently published first, de-duplicated: who is actually filing now.
  const slugs = [...new Set(articles.map((a) => a.reporterSlug))].slice(0, 3)
  const people = await Promise.all(slugs.map(async (slug) => getReporter(slug)))

  return (
    <section className="col-mod">
      <div className="lbl k">Reporters on duty</div>
      <ul className="duty">
        {people.filter((r) => r !== undefined).map((r) => (
          <li key={r.slug}>
            <span className="av" aria-hidden="true">{r.name.slice(0, 1)}</span>
            <span className="who">
              <span className="t">{r.name}</span>
              <span className="meta">{r.tier} · {r.city}</span>
            </span>
            {r.verified ? <span className="tick lbl">Verified</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
