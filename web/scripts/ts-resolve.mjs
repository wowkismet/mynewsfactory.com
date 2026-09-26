/**
 * Resolve extensionless relative imports to their .ts file.
 *
 * The library is written for bundlers -- Next and vitest both resolve
 * `./client` to `client.ts` -- but Node's ESM resolver does not guess
 * extensions, so `npm run db:migrate` failed on the first relative import it
 * reached. Adding extensions across the codebase would mean changing files
 * that are otherwise correct; adding a dependency to run one script would put
 * a build tool on the deployment path.
 *
 * This hook bridges the two, and only in the direction that is safe: it tries
 * the `.ts` file first and falls through to Node's own resolution if there
 * isn't one, so nothing that already resolved changes behaviour.
 */

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../')
  const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier)

  if (relative && !hasExtension) {
    try {
      return await nextResolve(`${specifier}.ts`, context)
    } catch {
      // No .ts alongside it -- a directory index, or a genuine mistake. Either
      // way Node's own resolution gives the better error.
    }
  }

  return nextResolve(specifier, context)
}
