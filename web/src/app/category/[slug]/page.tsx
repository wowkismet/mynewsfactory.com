import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getArticlesByCategory, getCategory } from '@/lib/content'
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
 * trade-off, so the default is to read a section on every request. Caching comes
 * back with the invalidation to go with it (§65).
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = await getCategory(slug)
  if (!category) return { title: 'Section not found' }
  return { title: category.name, description: category.blurb }
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params
  const category = await getCategory(slug)
  if (!category) notFound()

  const articles = await getArticlesByCategory(slug)

  return (
    <div className="shell">
      <div className="pagehead">
        <div className="lbl" style={{ color: 'var(--red)' }}>Section</div>
        <h1>{category.name}</h1>
        <p>{category.blurb}</p>
      </div>
      <section className="band" style={{ paddingBottom: 40 }}>
        {articles.length === 0 ? (
          <p className="empty">No published stories in this section yet.</p>
        ) : (
          <div className="cards">
            {articles.map((a) => <StoryCard key={a.slug} article={a} />)}
          </div>
        )}
      </section>
    </div>
  )
}
