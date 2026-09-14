import Link from 'next/link'
import { getArticles, getLead } from '@/lib/content'
import { HeroStory, RailItem, StoryCard } from '@/components/Story'
import {
  CityStrip,
  LiveWorld,
  Marketplace,
  QuickPoll,
  ServicesStrip,
  SideNav,
  Weather,
} from '@/components/Panels'

export default async function HomePage() {
  const [lead, all] = await Promise.all([getLead(), getArticles()])
  const rest = all.filter((a) => a.slug !== lead?.slug)
  const rail = rest.slice(0, 4)
  const top = rest.slice(0, 8)

  return (
    <div className="shell portal">
      <div className="grid4">
        <SideNav current="/" />

        <div>
          {lead ? <HeroStory article={lead} /> : null}
        </div>

        <LiveWorld />

        <div className="rail rail-c">
          <div className="rh">
            <span className="lbl badge live" style={{ background: 'transparent', color: 'var(--red)' }}>
              Live now
            </span>
            <Link className="lbl" href="/category/breaking" style={{ color: 'var(--ink4)' }}>View all</Link>
          </div>
          {rail.map((a) => <RailItem key={a.slug} article={a} />)}
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
