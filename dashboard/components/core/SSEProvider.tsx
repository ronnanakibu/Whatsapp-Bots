'use client'

import { useSSE } from '@/hooks/useSSE'

/** Mounts SSE connection globally inside the app shell */
export default function SSEProvider({ children }: { children: React.ReactNode }) {
    useSSE()
    return <>{children}</>
}
