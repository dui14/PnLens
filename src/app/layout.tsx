import type { Metadata } from 'next'
import './globals.css'
import { I18nProvider } from '@/lib/i18n/client'
import { getServerDictionary } from '@/lib/i18n/server'

const APP_NAME = 'PnLens'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary()
  return {
    title: APP_NAME,
    description: t.meta.description,
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  const { locale } = await getServerDictionary()
  return (
    <html lang={locale} className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="font-display antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  )
}
