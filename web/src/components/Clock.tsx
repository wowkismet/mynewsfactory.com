'use client'

import { useEffect, useState } from 'react'

const dayFmt = { weekday: 'long' } as const
const dateFmt = { day: '2-digit', month: 'short', year: 'numeric' } as const
const timeFmt = { hour: '2-digit', minute: '2-digit', hour12: false } as const

/**
 * Live masthead clock.
 *
 * Seeded synchronously so the server renders a real date rather than a
 * placeholder, then ticks after mount. Server and client clocks can differ by
 * a second or by timezone, so the rendered values are marked as expected
 * hydration mismatches.
 */
export default function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="clock">
      <div>
        <div className="big" suppressHydrationWarning>
          {now.toLocaleDateString('en-IN', dayFmt)}
        </div>
        <div className="sm" suppressHydrationWarning>
          {now.toLocaleDateString('en-IN', dateFmt).toUpperCase()}
        </div>
      </div>
      <div>
        <div className="big" suppressHydrationWarning>
          {now.toLocaleTimeString('en-IN', timeFmt)}
        </div>
        <div className="sm">IST · MUMBAI</div>
      </div>
    </div>
  )
}
