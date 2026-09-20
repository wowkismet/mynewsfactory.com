import Link from 'next/link'
import { getArticles, getCategories, getCities, getReporter } from '@/lib/content'
import { money, moneyRange, pricing } from '@/lib/pricing'
import { Artwork } from './Artwork'
import { timeAgo, views } from './Story'

const SIDE_LINKS: { label: string; href: string; note?: string; air?: boolean }[] = [
  { label: 'Home', href: '/' },
  { label: 'Live TV', href: '/category/breaking', note: 'On air', air: true },
  { label: 'Videos', href: '/category/technology' },
  { label: 'News', href: '/category/breaking' },
  { label: 'Polls', href: '#polls', note: '12' },
  { label: 'Surveys', href: '#surveys', note: '8 paid' },
  { label: 'Interviews', href: '#interview' },
  { label: 'Success Stories', href: '#story' },
  { label: 'Biographies', href: '#biography' },
  { label: 'My City', href: '/city/mumbai' },
]

export function SideNav({ current = '/' }: { current?: string }) {
  return (
    <nav className="sidenav" aria-label="Portal sections">
      {SIDE_LINKS.map((l) => (
        <Link key={l.label} href={l.href} className={l.href === current ? 'on' : undefined}>
          <span>{l.label}</span>
          {l.note ? <span className={`n${l.air ? ' air' : ''}`}>{l.note}</span> : null}
        </Link>
      ))}
    </nav>
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

export function LiveWorld() {
  return (
    <aside className="world">
      <div className="lbl k">Live world</div>
      <div className="stats">
        <div className="stat">
          <div className="lbl k">Countries</div>
          <div className="v">195+</div>
        </div>
        <div className="stat">
          <div className="lbl k">Live news</div>
          <div className="v">5,482</div>
        </div>
        <div className="stat wide">
          <div className="lbl k">Users online</div>
          <div className="v">1.2M</div>
        </div>
      </div>
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

const POLL_OPTIONS = [
  { label: 'AI & machine learning', pct: 42 },
  { label: 'Clean energy', pct: 28 },
  { label: 'Space technology', pct: 15 },
  { label: 'Biotechnology', pct: 10 },
  { label: 'Other', pct: 5 },
]

export function QuickPoll() {
  return (
    <section className="poll" id="polls">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span className="lbl">Quick poll</span>
        <span className="lbl coins">+25 coins</span>
      </div>
      <h3>Which technology will have the biggest impact in the next five years?</h3>
      {POLL_OPTIONS.map((o) => (
        <div className="opt" key={o.label}>
          <div className="optrow">
            <span>{o.label}</span>
            <span className="meta">{o.pct}%</span>
          </div>
          <div className="track2">
            <div className="fill" style={{ width: `${o.pct.toString()}%` }} />
          </div>
        </div>
      ))}
      <a className="btn" href="#vote" style={{ marginTop: 6 }}>Vote now</a>
    </section>
  )
}

export function Weather() {
  return (
    <aside className="weather">
      <div className="lbl" style={{ opacity: 0.75 }}>My city weather</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 600, marginTop: 6 }}>Mumbai</div>
      <div className="t" style={{ marginTop: 8 }}>28°</div>
      <div className="lbl" style={{ opacity: 0.75, marginTop: 6 }}>Partly cloudy</div>
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
