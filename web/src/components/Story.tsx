import Link from 'next/link'
import { Artwork } from './Artwork'
import type { ArticleSummary, Reporter } from '@/lib/types'
import { getReporter } from '@/lib/content'

/** Compact relative time, e.g. "12 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string, now: number = Date.UTC(2026, 8, 14, 18, 0, 0)): string {
  const mins = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins.toString()} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours.toString()} h ago`
  return `${Math.round(hours / 24).toString()} d ago`
}

export function views(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`
  return `${n.toString()} views`
}

export function Byline({ reporter }: { reporter: Reporter }) {
  return (
    <span className="meta">
      By {reporter.name}
      {reporter.verified ? ' · Verified' : ''} · {reporter.tier} · {reporter.city}
    </span>
  )
}

export async function HeroStory({ article }: { article: ArticleSummary }) {
  const reporter = await getReporter(article.reporterSlug)
  return (
    <article className="hero">
      <div className="figure">
        <span className="flag badge">{article.live ? 'Live' : 'Breaking news'}</span>
        <Artwork seed={article.slug} category={article.categorySlug} ratio="16:9" alt="" />
      </div>
      <div className="body">
        <div className="lbl" style={{ color: 'var(--red)' }}>{article.kicker}</div>
        <h2 style={{ marginTop: 8 }}>
          <Link href={`/news/${article.slug}`}>{article.title}</Link>
        </h2>
        <p>{article.standfirst}</p>
        <div className="foot">
          <Link className="btn btn--red" href={`/news/${article.slug}`}>Read full story</Link>
          {reporter ? <Byline reporter={reporter} /> : null}
          <span className="meta">{views(article.views)} · {article.readMinutes} min read</span>
        </div>
      </div>
    </article>
  )
}

export async function StoryCard({ article }: { article: ArticleSummary }) {
  const reporter = await getReporter(article.reporterSlug)
  return (
    <article className="card">
      <div className="figure">
        <Artwork seed={article.slug} category={article.categorySlug} ratio="16:9" alt="" />
      </div>
      <div className="body">
        <div className="lbl" style={{ color: 'var(--red)' }}>{article.kicker}</div>
        <h3><Link href={`/news/${article.slug}`}>{article.title}</Link></h3>
        <p>{article.standfirst.slice(0, 118)}…</p>
        <div className="foot meta">
          {views(article.views)} · {timeAgo(article.publishedAt)}
          {reporter ? ` · ${reporter.name}` : ''}
        </div>
      </div>
    </article>
  )
}

export function RailItem({ article }: { article: ArticleSummary }) {
  return (
    <Link className="item" href={`/news/${article.slug}`}>
      <span className="thumb">
        <Artwork seed={article.slug} category={article.categorySlug} ratio="1:1" alt="" />
      </span>
      <span>
        <h4>{article.title}</h4>
        <span className="m meta">{views(article.views)} · {timeAgo(article.publishedAt)}</span>
      </span>
    </Link>
  )
}
