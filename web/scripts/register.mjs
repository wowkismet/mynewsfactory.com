/**
 * Installs the TypeScript resolution hook for the database CLI.
 *
 * Loaded with `node --import`, which runs it before the entry module so the
 * hook is in place for the very first import.
 */

import { register } from 'node:module'

register('./ts-resolve.mjs', import.meta.url)
