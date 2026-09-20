import Link from 'next/link'
import { getArticles, getLead } from '@/lib/content'
import { HeroStory, RailItem, StoryCard } from '@/components/Story'
import {
  CityDesks,
  CityStrip,
  LiveWorld,
  Marketplace,
  QuickPoll,
  ReportersOnDuty,
  SectionIndex,
  ServicesStrip,
  SideNav,
  TrendingList,
  Weather,
} from '@/components/Panels'

export default async function HomePage() {
  const [lead, all] = await Promise.all([getLead(), getArticles()])
  const rest = all.filter((a) => a.slug !== lead?.slug)
  // Six in the rail rather than four: at wide widths the rail reflows into a
  // full-width row, and four items left it short.
  const rail = rest.slice(0, 8)
  // A secondary lead under the hero. Without it the main column ran ~200px
  // shorter than the rails, which is the gap this page had.
  const secondary = rest.slice(0, 2)
  const top = rest.slice(2, 10)

  return (
    <div className="shell portal">
      <div className="grid4">
        {/* Each column carries its own stack, so the four end at comparable
            heights instead of leaving a band of empty page beneath the short
            ones. */}
        <div className="col col-nav">
          <SideNav current="/" />
          <TrendingList />
        </div>

        <div className="col col-main">
          {lead ? <HeroStory article={lead} /> : null}
          {/* Compact rows, not cards: full cards added ~470px and swung the
              imbalance the other way. */}
          <div className="secondary rail">
            <div className="rh">
              <span className="lbl k">More top stories</span>
              <Link className="lbl" href="/category/breaking" style={{ color: 'var(--ink4)' }}>View all</Link>
            </div>
            <div className="items">
              {secondary.map((a) => <RailItem key={a.slug} article={a} />)}
            </div>
          </div>
        </div>

        <div className="col col-world">
          <LiveWorld />
          <CityDesks />
          <ReportersOnDuty />
        </div>

        <div className="rail rail-c">
          <div className="rh">
            <span className="lbl badge live" style={{ background: 'transparent', color: 'var(--red)' }}>
              Live now
            </span>
            <Link className="lbl" href="/category/breaking" style={{ color: 'var(--ink4)' }}>View all</Link>
          </div>
          <div className="items">
            {rail.map((a) => <RailItem key={a.slug} article={a} />)}
          </div>
        </div>
      </div>

      <section className="band">
        <div className="rule-head">
          <h2>Top news</h2>
          <Link href="/category/breaking">View all</Link>
        </div>
        <div className="cards">
          {top.map((a) => <StoryCard key={a.slug} article={a} />)}
        </div>
      </section>

      <SectionIndex />

      <Marketplace />

      <section className="band">
        <div className="grid4" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
          <ServicesStrip />
          <div style={{ display: 'grid', gap: 14 }}>
            <QuickPoll />
            <Weather />
          </div>
        </div>
      </section>

      <CityStrip />
    </div>
  )
}
