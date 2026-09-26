/**
 * Per-request Content Security Policy (§49, §77).
 *
 * The policy used to live in `next.config.mjs` as a static header, and it was
 * wrong in a way nothing caught: `script-src 'self'` with no nonce blocks the
 * inline bootstrap scripts the App Router emits, so React never hydrated. The
 * pages looked right because they are server-rendered -- every form, button
 * and menu was simply inert. A portal made of static pages cannot show that
 * symptom, which is why it survived until the first form was added.
 *
 * The fix is the nonce, not a weaker policy. `'unsafe-inline'` would have made
 * the forms work and thrown away most of what a CSP is for: it permits exactly
 * the injected `<script>` that the policy exists to stop.
 *
 * Next reads the nonce out of the request's own CSP header and stamps it onto
 * the scripts it emits, so the header is set on the request as well as the
 * response. `'strict-dynamic'` then lets those nonced scripts load the chunks
 * they need, without the policy having to enumerate them.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  // The dev server compiles and hot-reloads with eval. Production must not
  // allow it, so the two policies genuinely differ -- and the difference is
  // narrow and written down rather than a blanket relaxation.
  const scriptSrc =
    process.env.NODE_ENV === 'production'
      ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Styles stay 'unsafe-inline': the framework emits inline style attributes
    // and there is no nonce path for them. An injected style is a defacement
    // risk, not code execution, so this is the weaker half of the policy by
    // some distance -- noted rather than hidden.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy', csp)

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except the static asset paths, which are immutable files
     * served straight from disk: a policy on them protects nothing and the
     * middleware hop costs something on every one.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
