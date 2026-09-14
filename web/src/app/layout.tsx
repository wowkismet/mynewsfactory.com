import type { Metadata } from 'next'
import './globals.css'
import { MainNav, Masthead, SiteFooter, Ticker, TopBar } from '@/components/Chrome'
import { getBreaking } from '@/lib/content'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mynewsfactory.com'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'My News Factory — people-powered global news',
    template: '%s · My News Factory',
  },
  description:
    'The world’s people-powered global news, media, research, advertising and rewards network. Report, connect, create, participate, earn.',
  openGraph: {
    siteName: 'My News Factory',
    type: 'website',
    url: siteUrl,
  },
  robots: { index: true, follow: true },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const breaking = await getBreaking()
  const headlines = breaking.map((a) => `${a.kicker.toUpperCase()} · ${a.title}`)

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Libre+Franklin:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <TopBar />
        <Masthead />
        <MainNav />
        <Ticker headlines={headlines} />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  )
}
