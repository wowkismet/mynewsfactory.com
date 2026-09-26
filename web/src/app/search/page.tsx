/**
 * /search -- published stories matching a query (§39).
 *
 * Honest about what it is: a case-insensitive match over the headline,
 * standfirst and kicker of published stories. Not ranked, no typo tolerance,
 * no body search. §39 wants all three and they arrive with the search service
 * in §65; claiming them here with a LIKE would be a feature that exists only
 * on the label.
 */

import { Suspense } from 'react'
import Link from 'next/link'
import { db } from '@/lib/db/pool'
import { searchPublished } from '@/lib/db/newsroom'

export const metadata = { title: 'Search · My News Factory' }
export const dynamic = 'force-dynamic'

async function Results({ query }: { query: string }) {
  if (query === '') {
    return <p className="empty">Type something to search for.</p>
  }

  let hits: Awaited<ReturnType<typeof searchPublished>>
  try {
    hits = await searchPublished(db(), query)
  } catch (error) {
    console.error('[search] failed', {
      detail: error instanceof Error ? error.message : String(error),
    })
    return (
      <p className="authnote authnote--bad">
        Search is unavailable — the newsroom database did not answer. This is not a result of
        nothing matching.
      </p>
    )
  }

  if (hits.length === 0) {
    return <p className="empty">Nothing published matches “{query}”.</p>
  }

  return (
    <>
      <p className="meta">
        {hits.length.toLocaleString('en')} {hits.length === 1 ? 'story' : 'stories'}
      </p>
      <ul className="results">
        {hits.map((hit) => (
          <li key={hit.slug}>
            <Link href={`/news/${hit.slug}`}>{hit.title}</Link>
            <span className="meta">
              {hit.reporterName} · {hit.categorySlug}
              {hit.citySlug === null ? '' : ` · ${hit.citySlug}`}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params.q
  const query = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 120).trim() ?? ''

  return (
    <div className="shell portal">
      <div className="pagehead">
        <p className="lbl">Search</p>
        <h1>{query === '' ? 'Search' : query}</h1>
        <p>Headlines, standfirsts and kickers of published stories.</p>
      </div>

      <section className="band">
        <form className="searchbox" action="/search" method="get" role="search">
          <label className="lbl" htmlFor="q">Search published stories</label>
          <input id="q" name="q" type="search" defaultValue={query} maxLength={120} />
          <button className="btn" type="submit">Search</button>
        </form>
      </section>

      <section className="band">
        <Suspense fallback={<p className="empty">Searching…</p>}>
          <Results query={query} />
        </Suspense>
      </section>
    </div>
  )
}
