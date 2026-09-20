/**
 * Development and test seed (§81, docs/DECISIONS.md D-010).
 *
 * Inserts the demonstration fixtures. Refuses to run against a production
 * environment: a news platform serving invented articles under real reporter
 * names is an editorial integrity failure, not a placeholder.
 */

import { articles, categories, cities, reporters } from '../fixtures'
import type { Db } from './client'
import { transaction } from './client'

/** Reporter slugs are derived once so articles can reference them by id. */
async function seedReference(tx: Db): Promise<void> {
  await tx.query(
    `INSERT INTO currencies (code, name, minor_unit) VALUES
       ('INR', 'Indian Rupee', 2),
       ('AED', 'UAE Dirham', 2),
       ('USD', 'United States Dollar', 2)
     ON CONFLICT (code) DO NOTHING`,
  )

  await tx.query(
    `INSERT INTO languages (code, name, rtl) VALUES
       ('en', 'English', false),
       ('hi', 'Hindi', false),
       ('mr', 'Marathi', false),
       ('ta', 'Tamil', false),
       ('kn', 'Kannada', false),
       ('pa', 'Punjabi', false),
       ('ml', 'Malayalam', false),
       ('ar', 'Arabic', true)
     ON CONFLICT (code) DO NOTHING`,
  )

  await tx.query(
    `INSERT INTO countries (code, name, currency_code, default_language, active) VALUES
       ('IN', 'India', 'INR', 'en', true),
       -- Display names match what the portal currently shows. Renaming a
       -- country is an editorial decision, not a migration.
       ('AE', 'UAE', 'AED', 'en', true)
     ON CONFLICT (code) DO NOTHING`,
  )
}

async function seedCities(tx: Db): Promise<void> {
  for (const city of cities) {
    // Country is carried on the fixture as a display name; map it back to the
    // code. Unknown countries are a seed bug, so fail rather than guess.
    const { rows } = await tx.query<{ code: string }>(
      'SELECT code FROM countries WHERE name = $1',
      [city.country],
    )
    const country = rows[0]
    if (country === undefined) {
      throw new Error(`Seed: no country named "${city.country}" for city ${city.slug}`)
    }

    let stateId: string | null = null
    if (city.state !== '') {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO states (country_code, slug, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (country_code, slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [country.code, city.state.toLowerCase().replace(/[^a-z0-9]+/g, '-'), city.state],
      )
      stateId = inserted.rows[0]?.id ?? null
    }

    await tx.query(
      `INSERT INTO cities (slug, name, newsroom_label, country_code, state_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO NOTHING`,
      [city.slug, city.name, city.newsroom, country.code, stateId],
    )
  }
}

async function seedCategories(tx: Db): Promise<void> {
  let order = 0
  for (const category of categories) {
    await tx.query(
      `INSERT INTO categories (slug, name, blurb, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING`,
      [category.slug, category.name, category.blurb, order],
    )
    order += 1
  }
}

async function seedReporters(tx: Db): Promise<void> {
  for (const reporter of reporters) {
    const user = await tx.query<{ id: string }>(
      `INSERT INTO users (email, display_name, status)
       VALUES ($1, $2, 'ACTIVE')
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [`${reporter.slug}@seed.invalid`, reporter.name],
    )
    const userId = user.rows[0]?.id
    if (userId === undefined) throw new Error(`Seed: could not create user for ${reporter.slug}`)

    const city = await tx.query<{ id: string }>('SELECT id FROM cities WHERE name = $1', [
      reporter.city,
    ])

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO reporters (user_id, slug, name, tier, verified, city_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        userId,
        reporter.slug,
        reporter.name,
        reporter.tier,
        reporter.verified,
        city.rows[0]?.id ?? null,
      ],
    )

    const reporterId =
      inserted.rows[0]?.id ??
      (await tx.query<{ id: string }>('SELECT id FROM reporters WHERE slug = $1', [reporter.slug]))
        .rows[0]?.id

    if (reporterId === undefined) continue

    // Fixtures carry language display names; the schema keys on codes. Resolve
    // by name and fail loudly on an unknown one rather than skipping it --
    // a reporter silently losing a language is the kind of quiet data loss
    // that is only noticed once it is in production.
    for (const language of reporter.languages) {
      const resolved = await tx.query<{ code: string }>(
        'SELECT code FROM languages WHERE name = $1',
        [language],
      )
      const code = resolved.rows[0]?.code
      if (code === undefined) {
        throw new Error(`Seed: no language named "${language}" for reporter ${reporter.slug}`)
      }

      await tx.query(
        `INSERT INTO reporter_languages (reporter_id, language_code)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [reporterId, code],
      )
    }
  }
}

async function seedNews(tx: Db): Promise<void> {
  for (const article of articles) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO news (
         slug, category_id, city_id, reporter_id,
         kicker, title, standfirst,
         status, published_at,
         read_minutes, view_count, breaking, live, source_count
       )
       SELECT $1,
              cat.id,
              city.id,
              rep.id,
              $5, $6, $7,
              'PUBLISHED', $8::timestamptz,
              $9, $10, $11, $12, $13
         FROM categories cat
         JOIN reporters rep ON rep.slug = $4
         LEFT JOIN cities city ON city.slug = $3
        WHERE cat.slug = $2
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        article.slug,
        article.categorySlug,
        article.citySlug,
        article.reporterSlug,
        article.kicker,
        article.title,
        article.standfirst,
        article.publishedAt,
        article.readMinutes,
        article.views,
        article.breaking ?? false,
        article.live ?? false,
        article.sourceCount ?? 0,
      ],
    )

    const newsId = rows[0]?.id
    if (newsId === undefined) continue

    await tx.query(
      `INSERT INTO news_versions (news_id, version, title, standfirst, body, status, note)
       VALUES ($1, 1, $2, $3, $4, 'PUBLISHED', 'Seeded')`,
      [newsId, article.title, article.standfirst, article.body],
    )
  }
}

export interface SeedOptions {
  /** Set only by tests that have constructed an isolated database. */
  allowInProduction?: boolean
}

export async function seed(db: Db, options: SeedOptions = {}): Promise<void> {
  if (process.env.NODE_ENV === 'production' && options.allowInProduction !== true) {
    throw new Error(
      'Refusing to seed demonstration content in production. ' +
        'Production reads real editorial content; see docs/DECISIONS.md D-010.',
    )
  }

  await transaction(db, async (tx) => {
    await seedReference(tx)
    await seedCities(tx)
    await seedCategories(tx)
    await seedReporters(tx)
    await seedNews(tx)
  })
}
