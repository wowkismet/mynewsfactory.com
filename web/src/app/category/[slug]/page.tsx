import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getArticlesByCategory, getCategories, getCategory } from '@/lib/content'
import { StoryCard } from '@/components/Story'

interface Props { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  const categories = await getCategories()
  return categories.map((c) => ({ slug: c.slug }))
}

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
