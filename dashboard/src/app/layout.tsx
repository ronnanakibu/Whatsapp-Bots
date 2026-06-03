import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
    title: 'BOTWA 2.0 — Command Center',
    description: 'Immersive Multimedia Operating System powered by the BOTWA ecosystem',
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en" className="h-full">
            <body className="h-full overflow-hidden antialiased">
                {children}
            </body>
        </html>
    )
}
