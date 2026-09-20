/**
 * Editorial content source for the portal.
 *
 * Phase 1 serves a fixed in-memory set so the front end can be built and
 * reviewed independently. Every accessor below is async and returns the same
 * shapes a database query will, so swapping in PostgreSQL in Phase 2 touches
 * this file only.
 */

import type { Article, Category, City, Reporter } from './types'

const categories: Category[] = [
  { slug: 'breaking', name: 'Breaking', blurb: 'Developing stories as they are verified.' },
  { slug: 'business', name: 'Business', blurb: 'Markets, companies and the economy.' },
  { slug: 'my-city', name: 'My City', blurb: 'Every city has a newsroom.' },
  { slug: 'sports', name: 'Sports', blurb: 'Results, fixtures and the people behind them.' },
  { slug: 'technology', name: 'Technology', blurb: 'Products, policy and the industry that builds them.' },
  { slug: 'health', name: 'Health', blurb: 'Public health, medicine and wellbeing.' },
  { slug: 'global', name: 'Global', blurb: 'World reporting from the correspondent network.' },
  { slug: 'india', name: 'India', blurb: 'National reporting from every state.' },
  { slug: 'finance', name: 'Finance', blurb: 'Banking, credit and personal finance.' },
  { slug: 'markets', name: 'Markets', blurb: 'Equities, currencies and commodities.' },
  { slug: 'ai', name: 'AI', blurb: 'Models, policy and the industry building them.' },
  { slug: 'education', name: 'Education', blurb: 'Schools, universities and skills.' },
]

const cities: City[] = [
  { slug: 'mumbai', name: 'Mumbai', newsroom: 'My Mumbai', country: 'India', state: 'Maharashtra' },
  { slug: 'delhi', name: 'Delhi', newsroom: 'My Delhi', country: 'India', state: 'Delhi' },
  { slug: 'bengaluru', name: 'Bengaluru', newsroom: 'My Bengaluru', country: 'India', state: 'Karnataka' },
  { slug: 'dubai', name: 'Dubai', newsroom: 'My Dubai', country: 'UAE', state: 'Dubai' },
]

const reporters: Reporter[] = [
  { id: 'MNF-IN-4471', slug: 'a-deshmukh', name: 'A. Deshmukh', tier: 'Gold', verified: true, city: 'Mumbai', languages: ['Hindi', 'English', 'Marathi'] },
  { id: 'MNF-IN-5120', slug: 'r-iyer', name: 'R. Iyer', tier: 'Senior', verified: true, city: 'Bengaluru', languages: ['English', 'Kannada', 'Tamil'] },
  { id: 'MNF-IN-3308', slug: 's-kaur', name: 'S. Kaur', tier: 'Silver', verified: true, city: 'Delhi', languages: ['Hindi', 'Punjabi', 'English'] },
  { id: 'MNF-AE-0914', slug: 'm-al-rashid', name: 'M. Al-Rashid', tier: 'Global Correspondent', verified: true, city: 'Dubai', languages: ['Arabic', 'English'] },
  { id: 'MNF-IN-7702', slug: 'p-nair', name: 'P. Nair', tier: 'Bronze', verified: false, city: 'Mumbai', languages: ['English', 'Malayalam'] },
]

const articles: Article[] = [
  {
    slug: 'mumbai-drainage-audit-fourteen-wards-flagged',
    kicker: 'Mumbai · Civic',
    title: 'City clears drainage audit ahead of monsoon, 14 wards flagged for urgent work',
    standfirst:
      'Municipal engineers finished ward-level inspections this week. Fourteen low-lying wards were marked for immediate desilting, with contractors given four weeks before the first rains.',
    body: [
      'Ward-level inspections concluded on Tuesday, closing a six-week exercise that covered every drainage catchment in the city. Engineers recorded silt depth, outfall condition and pumping capacity at each site.',
      'Fourteen wards were flagged for urgent intervention. Most sit in the eastern suburbs, where flooding has recurred in each of the last three monsoons. Contractors have been given a four-week window to complete desilting.',
      'The audit also recommended permanent pumping capacity at four chronic flooding points. That proposal goes before the standing committee next month and is not funded in the current budget.',
      'Residents in the flagged wards told this reporter that desilting in previous years had been completed late, and in several cases after the first heavy rainfall had already caused waterlogging.',
    ],
    categorySlug: 'my-city',
    citySlug: 'mumbai',
    reporterSlug: 'a-deshmukh',
    publishedAt: '2026-09-14T17:48:00Z',
    readMinutes: 4,
    views: 12480,
    breaking: true,
  },
  {
    slug: 'rupee-steadies-as-central-bank-signals-hold',
    kicker: 'Finance',
    title: 'Rupee steadies as central bank signals no change to rates',
    standfirst:
      'The currency recovered through the afternoon session after policymakers indicated the current stance would hold into the next quarter.',
    body: [
      'The rupee opened weaker but recovered through the afternoon, closing near where it began the week. Dealers attributed the turn to guidance that the policy stance would be held rather than tightened.',
      'Bond yields eased slightly on the same signal. Analysts noted that the move was modest and that positioning ahead of next month’s review remains cautious.',
      'Importers had been hedging more aggressively through the previous fortnight, which traders said amplified the early weakness before the correction.',
    ],
    categorySlug: 'business',
    citySlug: null,
    reporterSlug: 'r-iyer',
    publishedAt: '2026-09-14T15:30:00Z',
    readMinutes: 3,
    views: 4208,
  },
  {
    slug: 'delhi-ring-road-service-lane-reopens',
    kicker: 'My City · Delhi',
    title: 'Ring Road service lane reopens after nine months of utility work',
    standfirst:
      'The stretch carried an estimated 40,000 vehicles a day before closure. Traffic police expect congestion at the adjoining junction to ease within a fortnight.',
    body: [
      'The service lane reopened to traffic on Sunday morning, nine months after it was closed for trunk utility replacement. The work ran roughly three months beyond its original schedule.',
      'Traffic police said diverted volumes had pushed queues at the adjoining junction well past their usual evening peak, and expect conditions to normalise within two weeks.',
      'Resurfacing on the final 300-metre section is still outstanding and will be carried out at night to avoid a further daytime closure.',
    ],
    categorySlug: 'my-city',
    citySlug: 'delhi',
    reporterSlug: 's-kaur',
    publishedAt: '2026-09-14T14:10:00Z',
    readMinutes: 3,
    views: 1914,
  },
  {
    slug: 'assembly-session-live-coverage',
    kicker: 'Live',
    title: 'Assembly session — rolling updates from three reporters',
    standfirst:
      'A live event hub drawing together floor proceedings, official statements and reporting from the press gallery.',
    body: [
      'This hub aggregates updates from three reporters in the press gallery alongside official statements as they are released.',
      'The budget discussion is scheduled for the afternoon sitting. Opposition members have given notice of an adjournment motion on water supply.',
      'Updates are timestamped and attributed to the reporter who filed them. Official documents are linked at source where published.',
    ],
    categorySlug: 'breaking',
    citySlug: 'mumbai',
    reporterSlug: 'a-deshmukh',
    publishedAt: '2026-09-14T13:00:00Z',
    readMinutes: 2,
    views: 8830,
    live: true,
    sourceCount: 7,
  },
  {
    slug: 'bengaluru-metro-phase-three-tender-opens',
    kicker: 'Bengaluru · Infrastructure',
    title: 'Metro Phase 3 tender opens, bids close in six weeks',
    standfirst:
      'Two elevated corridors totalling 44 kilometres go to tender, with civil packages split across four contracts.',
    body: [
      'The tender covers two elevated corridors totalling roughly 44 kilometres, with civil work divided into four packages to widen the bidder pool.',
      'Bids close in six weeks. Officials indicated award is targeted for the following quarter, subject to technical evaluation.',
      'Land acquisition along one corridor remains partially incomplete, which contractors have previously cited as a schedule risk on comparable projects.',
    ],
    categorySlug: 'my-city',
    citySlug: 'bengaluru',
    reporterSlug: 'r-iyer',
    publishedAt: '2026-09-14T11:20:00Z',
    readMinutes: 4,
    views: 3376,
  },
  {
    slug: 'dubai-logistics-corridor-freight-volumes',
    kicker: 'Dubai · Trade',
    title: 'Freight volumes on the new logistics corridor climb for a fourth quarter',
    standfirst:
      'Operators report sustained growth, though capacity at one inland terminal is now the constraint on further gains.',
    body: [
      'Volumes rose again in the most recent quarter, the fourth consecutive increase since the corridor opened to commercial traffic.',
      'Operators said the growth is now constrained by handling capacity at one inland terminal rather than by demand.',
      'An expansion of that terminal has been proposed but no construction timetable has been published.',
    ],
    categorySlug: 'business',
    citySlug: 'dubai',
    reporterSlug: 'm-al-rashid',
    publishedAt: '2026-09-14T09:45:00Z',
    readMinutes: 3,
    views: 2140,
  },
  {
    slug: 'district-hospital-adds-dialysis-capacity',
    kicker: 'Health',
    title: 'District hospital adds dialysis capacity after year-long waiting list',
    standfirst:
      'Eight new stations open this month, roughly doubling weekly sessions at a facility that serves four surrounding talukas.',
    body: [
      'Eight additional dialysis stations begin operating this month, close to doubling the number of sessions the hospital can provide each week.',
      'The facility serves patients from four surrounding talukas, many of whom had been travelling more than 60 kilometres for treatment.',
      'Hospital administrators said staffing for the additional stations is in place, and that the waiting list should clear within three months.',
    ],
    categorySlug: 'health',
    citySlug: 'mumbai',
    reporterSlug: 'p-nair',
    publishedAt: '2026-09-14T08:05:00Z',
    readMinutes: 3,
    views: 1622,
  },
  {
    slug: 'state-league-final-decided-in-extra-time',
    kicker: 'Sports',
    title: 'State league final decided in extra time after goalless ninety',
    standfirst:
      'A substitute settled a tight final that had produced few clear chances before the interval.',
    body: [
      'Neither side created much in a cautious opening hour, with both defences comfortable and the midfield congested.',
      'The decisive goal came eight minutes into extra time, from a substitute introduced shortly before the end of normal play.',
      'The winners qualify for the national round beginning next month.',
    ],
    categorySlug: 'sports',
    citySlug: 'delhi',
    reporterSlug: 's-kaur',
    publishedAt: '2026-09-13T19:40:00Z',
    readMinutes: 2,
    views: 5905,
  },
  {
    slug: 'small-manufacturers-adopt-shared-testing-labs',
    kicker: 'Technology',
    title: 'Small manufacturers turn to shared testing labs to meet export standards',
    standfirst:
      'Certification costs that were prohibitive individually are being met collectively through a cluster facility.',
    body: [
      'A shared testing facility opened this quarter, letting smaller manufacturers meet export certification requirements they could not fund individually.',
      'Members pay a usage fee rather than capital cost. Twenty-two units have signed up so far, most employing fewer than fifty people.',
      'Operators of the facility said demand has run ahead of projections and a second testing line is being considered.',
    ],
    categorySlug: 'technology',
    citySlug: 'bengaluru',
    reporterSlug: 'r-iyer',
    publishedAt: '2026-09-13T16:15:00Z',
    readMinutes: 4,
    views: 2988,
  },
]

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
