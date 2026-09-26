/**
 * A source-level check on the credential forms (§8, §57).
 *
 * This reads the files rather than rendering them, which is unusual and is the
 * point: the property being asserted is what the markup says, not what the
 * component does once JavaScript is running. A rendering test would mount the
 * component with its handler attached and prove nothing about the case that
 * matters -- the browser that never ran the handler.
 *
 * A form without `method="post"` falls back to a native GET, which puts every
 * field in the query string. On these forms that is a password, a TOTP code or
 * a recovery code, written into the URL bar, browser history, the referrer of
 * whatever loads next, and every access log on the way. It is a leak that only
 * appears when something else has already gone wrong, which is exactly when
 * nobody is looking.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(process.cwd(), 'src/components/auth')

const sources = readdirSync(DIR)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => ({ name, text: readFileSync(join(DIR, name), 'utf8') }))

describe('credential forms', () => {
  it('finds the forms it is meant to be checking', () => {
    const withForms = sources.filter((file) => file.text.includes('<form'))
    expect(withForms.length).toBeGreaterThanOrEqual(3)
  })

  it.each(sources.filter((file) => file.text.includes('<form')).map((f) => [f.name, f.text]))(
    '%s opens every form with method="post"',
    (name, text) => {
      const opens = [...text.matchAll(/<form\b[^>]*>/gs)]
      expect(opens.length, `${name} has no form`).toBeGreaterThan(0)

      for (const [tag] of opens) {
        expect(tag, `${name}: ${tag.slice(0, 60)}`).toContain('method="post"')
      }
    },
  )

  it('never puts a secret-bearing field in a GET form anywhere in the app', () => {
    // The search box is a GET form and should stay one -- a query belongs in a
    // shareable URL. What must never appear in one is a credential field.
    const appDir = join(process.cwd(), 'src')
    const secrets = /name="(password|code|recoveryCode|token)"/

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) return walk(full)
        return entry.name.endsWith('.tsx') ? [full] : []
      })

    for (const file of walk(appDir)) {
      const text = readFileSync(file, 'utf8')
      for (const [tag] of text.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)) {
        if (!secrets.test(tag)) continue
        expect(tag.slice(0, tag.indexOf('>')), file).toContain('method="post"')
      }
    }
  })
})
