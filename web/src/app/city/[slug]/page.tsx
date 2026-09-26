import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getArticlesByCity, getCity } from '@/lib/content'
import { StoryCard } from '@/components/Story'

interface Props { params: Promise<{ slug: string }> }

/**
 * Rendered per request, not prerendered (docs/DECISIONS.md D-022).
 *
 * These pages used to be built once from the fixtures, which was correct while
 * the content was a file. Now that an editor can publish, correct and withdraw
 * a story, a page baked at build time would keep serving a story after it was
 * unpublished, and keep serving the pre-correction text after a correction.
 * A withdrawal that does not take effect is a safety failure, not a caching
 * trade-off, so the default is to read a city desk on every request. Caching comes
 * back with the invalidation to go with it (§65).
 */
export const dynamic = 'force-dynamic'

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
