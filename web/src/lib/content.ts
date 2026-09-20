/**
 * Editorial content accessors.
 *
 * Still backed by fixtures. The database repository that replaces them lives in
 * `db/repository.ts` and is already tested against real PostgreSQL; rewiring
 * these call sites is the next step of Phase 1a.
 */

import type { Article, Category, City, Reporter } from './types'
import { articles, categories, cities, reporters } from './fixtures'

const byNewest = (a: Article, b: Article) =>
  new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()

export async function getCategories(): Promise<Category[]> {
  return categories
}

export async function getCategory(slug: string): Promise<Category | undefined> {
  return categories.find((c) => c.slug === slug)
}

export async function getCities(): Promise<City[]> {
  return cities
}

export async function getCity(slug: string): Promise<City | undefined> {
  return cities.find((c) => c.slug === slug)
}

export async function getReporter(slug: string): Promise<Reporter | undefined> {
  return reporters.find((r) => r.slug === slug)
}

export async function getArticles(): Promise<Article[]> {
  return [...articles].sort(byNewest)
}

export async function getArticle(slug: string): Promise<Article | undefined> {
  return articles.find((a) => a.slug === slug)
}

export async function getArticlesByCategory(slug: string): Promise<Article[]> {
  return articles.filter((a) => a.categorySlug === slug).sort(byNewest)
}

export async function getArticlesByCity(slug: string): Promise<Article[]> {
  return articles.filter((a) => a.citySlug === slug).sort(byNewest)
}

export async function getBreaking(): Promise<Article[]> {
  // Explicit comparisons: these flags are `boolean | undefined`, so `??` would
  // return `false` instead of falling through to `live`. See content.test.ts.
  return articles.filter((a) => a.breaking === true || a.live === true).sort(byNewest)
}

/** The lead story for the homepage. */
export async function getLead(): Promise<Article | undefined> {
  return (await getArticles())[0]
}

/** Stories related to `article`, preferring the same city, then category. */
export async function getRelated(article: Article, limit = 3): Promise<Article[]> {
  const pool = articles.filter((a) => a.slug !== article.slug)
  const scored = pool
    .map((a) => ({
      a,
      score: (a.citySlug === article.citySlug ? 2 : 0) + (a.categorySlug === article.categorySlug ? 1 : 0),
    }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score || byNewest(x.a, y.a))
  return scored.slice(0, limit).map((s) => s.a)
}
