import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="shell">
      <div className="pagehead">
        <div className="lbl" style={{ color: 'var(--red)' }}>404</div>
        <h1>That page isn’t here</h1>
        <p>The story may have been moved, unpublished or corrected. The newsroom is still open.</p>
      </div>
      <div style={{ paddingBlock: 26 }}>
        <Link className="btn btn--red" href="/">Back to the front page</Link>
      </div>
    </div>
  )
}
