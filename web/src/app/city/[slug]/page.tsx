import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getArticlesByCity, getCities, getCity } from '@/lib/content'
import { StoryCard } from '@/components/Story'

interface Props { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  const cities = await getCities()
  return cities.map((c) => ({ slug: c.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const city = await getCity(slug)
  if (!city) return { title: 'City not found' }
  return {
    title: city.newsroom,
    description: `Local reporting from ${city.name}, ${city.state} — ${city.country}.`,
  }
}

export default async function CityPage({ params }: Props) {
  const { slug } = await params
  const city = await getCity(slug)
  if (!city) notFound()

  const articles = await getArticlesByCity(slug)

  return (
    <div className="shell">
      <div className="pagehead">
        <div className="lbl" style={{ color: 'var(--cyan)' }}>
          {city.state} · {city.country}
        </div>
        <h1>{city.newsroom}</h1>
        <p>Every city has a newsroom. Local reporting, businesses, polls and assignments from {city.name}.</p>
      </div>
      <section className="band" style={{ paddingBottom: 40 }}>
        {articles.length === 0 ? (
          <p className="empty">No published stories from this city yet.</p>
        ) : (
          <div className="cards">
            {articles.map((a) => <StoryCard key={a.slug} article={a} />)}
          </div>
        )}
      </section>
    </div>
  )
}
