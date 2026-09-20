import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getArticle, getArticles, getCategory, getCity, getRelated, getReporter } from '@/lib/content'
import { StoryCard, timeAgo, views } from '@/components/Story'

interface Props { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  const all = await getArticles()
  return all.map((a) => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticle(slug)
  if (!article) return { title: 'Story not found' }
  return {
    title: article.title,
    description: article.standfirst,
    openGraph: { title: article.title, description: article.standfirst, type: 'article' },
  }
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const article = await getArticle(slug)
  if (!article) notFound()

  const [reporter, category, city, related] = await Promise.all([
    getReporter(article.reporterSlug),
    getCategory(article.categorySlug),
    article.citySlug ? getCity(article.citySlug) : Promise.resolve(undefined),
    getRelated(article),
  ])

  return (
    <div className="shell">
      <article className="article">
        <div className="lbl" style={{ color: 'var(--red)' }}>{article.kicker}</div>
        <h1>{article.title}</h1>
        <p className="stand">{article.standfirst}</p>

        <div className="byline">
          {reporter ? (
            <span className="meta">
              By <strong style={{ color: 'var(--ink)' }}>{reporter.name}</strong>
              {reporter.verified ? ' · Verified reporter' : ''} · {reporter.tier} · {reporter.city}
            </span>
          ) : null}
          <span className="meta">
            {timeAgo(article.publishedAt)} · {article.readMinutes} min read · {views(article.views)}
          </span>
          {article.live && article.sourceCount ? (
            <span className="badge live">Live hub · {article.sourceCount} sources</span>
          ) : null}
        </div>

        <div className="figure lbl">Image 16:9</div>

        <div className="prose">
          {article.body.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>

        <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--rule)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {category ? (
            <Link className="btn" href={`/category/${category.slug}`}>{category.name}</Link>
          ) : null}
          {city ? <Link className="btn" href={`/city/${city.slug}`}>{city.newsroom}</Link> : null}
        </div>
      </article>

      {related.length > 0 ? (
        <section className="band" style={{ paddingBottom: 40 }}>
          <div className="rule-head"><h2>Related stories</h2></div>
          <div className="cards">
            {related.map((a) => <StoryCard key={a.slug} article={a} />)}
          </div>
        </section>
      ) : null}
    </div>
  )
}
