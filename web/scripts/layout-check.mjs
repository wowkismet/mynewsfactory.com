/**
 * Responsive layout check.
 *
 * Measures the rendered page at every breakpoint and reports the two failures
 * that are invisible to a unit test and easy to reintroduce:
 *
 *   1. horizontal overflow -- the page scrolls sideways on a phone
 *   2. side-by-side columns of very different height -- the band of empty page
 *      this layout had, where three columns ended 285px above the fourth
 *
 * Usage: start the app on 127.0.0.1:3100, then
 *   node scripts/layout-check.mjs [--shots <dir>]
 *
 * Exits non-zero if a threshold is breached, so it can gate a change.
 */

import { chromium } from 'playwright'

const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const URL = process.env.CHECK_URL ?? 'http://127.0.0.1:3100/'
const WIDTHS = [1920, 1600, 1440, 1280, 1200, 1100, 1024, 900, 820, 768, 600, 480, 390, 360]

/** Above this, a row of columns reads as an unfinished page rather than a layout. */
const MAX_COLUMN_GAP = 160

const shotsFlag = process.argv.indexOf('--shots')
const shotsDir = shotsFlag > -1 ? process.argv[shotsFlag + 1] : null

const browser = await chromium.launch({ executablePath: CHROME })
let failures = 0

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } })
  await page.goto(URL, { waitUntil: 'networkidle' })

  if (shotsDir !== null) {
    await page.screenshot({ path: `${shotsDir}/${String(width)}.png` })
  }

  const result = await page.evaluate(() => {
    const grid = document.querySelector('.grid4')
    const boxes = grid === null
      ? []
      : [...grid.children].map((child) => {
          const r = child.getBoundingClientRect()
          return {
            name: child.className.replace('col ', '').split(' ')[0],
            top: Math.round(r.top),
            height: Math.round(r.height),
          }
        })

    // Children sharing a top edge are in the same visual row.
    const rows = new Map()
    for (const box of boxes) {
      const key = Math.round(box.top / 10)
      rows.set(key, [...(rows.get(key) ?? []), box])
    }

    let worst = 0
    let detail = ''
    for (const row of rows.values()) {
      if (row.length < 2) continue
      const heights = row.map((b) => b.height)
      const gap = Math.max(...heights) - Math.min(...heights)
      if (gap > worst) {
        worst = gap
        detail = row.map((b) => `${b.name}:${String(b.height)}`).join(' ')
      }
    }

    return {
      worst,
      detail,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  const problems = []
  if (result.overflow > 0) problems.push(`scrolls sideways by ${String(result.overflow)}px`)
  if (result.worst > MAX_COLUMN_GAP) problems.push(`column gap ${String(result.worst)}px`)

  const status = problems.length === 0 ? 'ok  ' : 'FAIL'
  if (problems.length > 0) failures += 1

  console.log(
    `${status} ${String(width).padStart(4)}  gap ${String(result.worst).padStart(4)}px  ` +
      `${result.detail || '(single column)'}${problems.length > 0 ? `  <- ${problems.join(', ')}` : ''}`,
  )

  await page.close()
}

await browser.close()

if (failures > 0) {
  console.error(`\n${String(failures)} width(s) failed.`)
  process.exit(1)
}
console.log('\nAll widths pass.')
