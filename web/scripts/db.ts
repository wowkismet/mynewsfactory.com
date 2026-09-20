/**
 * Database CLI: `npm run db:migrate` and `npm run db:seed`.
 *
 * Run with Node's built-in TypeScript support -- no build step, no extra
 * dependency, and the same source the application uses rather than a
 * reimplementation of it that can drift.
 */

import { closePool, db } from '../src/lib/db/pool.ts'
import { migrate } from '../src/lib/db/migrate.ts'
import { seed } from '../src/lib/db/seed.ts'

async function main(): Promise<void> {
  const command = process.argv[2] ?? ''

  switch (command) {
    case 'migrate': {
      const result = await migrate(db())
      if (result.applied.length === 0) {
        console.log(`Nothing to apply. ${result.skipped.length.toString()} migration(s) already in place.`)
      } else {
        for (const filename of result.applied) console.log(`applied  ${filename}`)
      }
      break
    }

    case 'seed': {
      await seed(db())
      console.log('Seeded demonstration content.')
      break
    }

    default:
      console.error('Usage: npm run db:migrate | npm run db:seed')
      process.exitCode = 1
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closePool()
}
