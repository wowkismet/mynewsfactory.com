/**
 * Environment validation (§51).
 *
 * Read once, at startup, and fail loudly if something required is missing or
 * malformed. The failure mode this prevents is the one §51 names directly: a
 * production process silently falling back to a development default.
 */

export interface Env {
  databaseUrl: string
  siteUrl: string
  isProduction: boolean
}

class EnvironmentError extends Error {
  constructor(problems: string[]) {
    super(
      `Environment is not usable:\n  - ${problems.join('\n  - ')}\n` +
        'See web/.env.example for the required variables.',
    )
    this.name = 'EnvironmentError'
  }
}

function readDatabaseUrl(raw: string | undefined, problems: string[]): string {
  if (raw === undefined || raw === '') {
    problems.push('DATABASE_URL is not set')
    return ''
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    problems.push('DATABASE_URL is not a valid URL')
    return ''
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    problems.push(`DATABASE_URL must be a postgres:// URL, got ${url.protocol}//`)
  }

  return raw
}

/**
 * Validates the environment and returns it.
 *
 * Throws rather than returning a partial result: a caller that has an Env has
 * one that is complete. The message names every problem at once, so a
 * misconfigured deployment is fixed in one pass rather than one variable per
 * restart.
 */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const problems: string[] = []

  const databaseUrl = readDatabaseUrl(source.DATABASE_URL, problems)

  const siteUrl = source.NEXT_PUBLIC_SITE_URL ?? ''
  if (siteUrl === '') {
    problems.push('NEXT_PUBLIC_SITE_URL is not set')
  } else {
    try {
      new URL(siteUrl)
    } catch {
      problems.push('NEXT_PUBLIC_SITE_URL is not a valid URL')
    }
  }

  const isProduction = source.NODE_ENV === 'production'

  // Production must not run against a database on the developer's own machine.
  // This is the "never silently use development credentials in production"
  // requirement of §51, made mechanical.
  if (isProduction && databaseUrl !== '') {
    const host = new URL(databaseUrl).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      problems.push(
        'DATABASE_URL points at localhost while NODE_ENV=production. ' +
          'Set it to the production database, or unset NODE_ENV for local work.',
      )
    }
  }

  if (problems.length > 0) throw new EnvironmentError(problems)

  return { databaseUrl, siteUrl, isProduction }
}
