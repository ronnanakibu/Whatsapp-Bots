// src/app/layout.tsx
import './globals.css'
import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'react-hot-toast'

export const metadata: Metadata = {
  title: 'RonnBot Dashboard',
  description: 'Premium real-time dashboard for WABOT 2.0',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Poppins:wght@300;400;500;600;700&family=Righteous&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
          <Toaster 
            position="top-right" 
            toastOptions={{
              style: {
                background: 'hsl(var(--surface-elevated))',
                color: 'hsl(var(--foreground))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius)',
                fontSize: '14px',
              }
            }} 
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
