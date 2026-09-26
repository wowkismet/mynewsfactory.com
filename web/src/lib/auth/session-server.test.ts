/**
 * Tests for the two decisions the account pages make in plain logic (§69).
 *
 * `currentViewer` needs a database and a cookie store, and is covered by the
 * API tests it shares its resolution with. What is worth isolating is the
 * redirect validation -- because an open redirect is a phishing primitive, not
 * a cosmetic bug -- and the surface routing, because it decides by permission
 * and must keep doing so.
 */

import { describe, expect, it } from 'vitest'
import { homeSurface } from './session-server'
import { safeNext } from './redirect'

describe('post-sign-in redirect', () => {
  it('keeps a site-relative path', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard')
    expect(safeNext('/news/mumbai-drainage-audit-fourteen-wards-flagged')).toBe(
      '/news/mumbai-drainage-audit-fourteen-wards-flagged',
    )
    expect(safeNext('/category/business?page=2')).toBe('/category/business?page=2')
  })

  it('falls back when nothing usable was supplied', () => {
    expect(safeNext(undefined)).toBe('/dashboard')
    expect(safeNext('')).toBe('/dashboard')
  })

  /**
   * The attack: a link to the real sign-in page that lands the victim on a
   * copy of the site after they authenticate. The link is genuine, which is
   * what makes it work.
   */
  it('refuses every off-site destination', () => {
    const attempts = [
      'https://evil.example/mynewsfactory',
      'http://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/redirect?to=https://evil.example',
    ]

    for (const attempt of attempts) {
      const result = safeNext(attempt)
      expect(result === '/dashboard' || result.startsWith('/redirect')).toBe(true)
      expect(result).not.toContain('evil.example/mynewsfactory')
      expect(result.startsWith('//')).toBe(false)
      expect(result.startsWith('/\\')).toBe(false)
    }

    // The two that must be refused outright rather than merely made relative.
    expect(safeNext('//evil.example')).toBe('/dashboard')
    expect(safeNext('https://evil.example/mynewsfactory')).toBe('/dashboard')
    expect(safeNext('javascript:alert(1)')).toBe('/dashboard')
  })
})

describe('which surface a viewer lands on', () => {
  it('sends a plain reader to their own feed', () => {
    expect(homeSurface(['news.read', 'rewards.earn']).key).toBe('reader')
  })

  it('routes by permission, not by role name', () => {
    expect(homeSurface(['news.read', 'news.submit']).key).toBe('reporter')
    expect(homeSurface(['news.read', 'news.review']).key).toBe('editor')
    expect(homeSurface(['news.read', 'ads.manage_own']).key).toBe('advertiser')
    expect(homeSurface(['news.read', 'roles.grant']).key).toBe('admin')
  })

  it('gives someone holding several the most capable one', () => {
    expect(homeSurface(['news.submit', 'news.review', 'users.suspend']).key).toBe('admin')
    expect(homeSurface(['news.submit', 'news.review']).key).toBe('editor')
  })

  it('never leaves a viewer without a surface', () => {
    expect(homeSurface([]).key).toBe('reader')
  })
})
