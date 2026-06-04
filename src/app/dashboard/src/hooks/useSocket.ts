// src/hooks/useSocket.ts
import { useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import { useDashboardStore } from '../store/dashboard'

let socket: Socket | null = null

export function useSocket() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!socket) {
      const socketUrl = 'http://ap2.nzb.zelpstore.id:25637'
      console.log(`Connecting to WebSocket singleton: ${socketUrl}`)
      
      socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
      })

      socket.on('connect', () => {
        console.log('WebSocket connected')
        useDashboardStore.getState().setConnected(true)
      })

      socket.on('disconnect', () => {
        console.log('WebSocket disconnected')
        useDashboardStore.getState().setConnected(false)
      })

      // Init data payload
      socket.on('init', (data) => {
        console.log('Received init payload', data)
        const s = useDashboardStore.getState()
        if (data.status) s.setBotStatus(data.status.state, data.status.qr)
        if (data.uptime) s.setUptime(data.uptime)
        if (data.metrics) s.updateMetrics(data.metrics)
        if (data.analytics) s.setAnalytics(data.analytics)
        if (data.commands) s.setCommandsList(data.commands)
        if (data.groups) s.setGroupsList(data.groups)
        if (data.users) s.setUsersList(data.users)
        if (data.dbTables) s.setDbTables(data.dbTables)
        if (data.logs) {
          const formattedLogs = data.logs.map((text: string, idx: number) => ({
            id: `init-${idx}-${Math.random().toString(36).substring(7)}`,
            timestamp: Date.now() - (data.logs.length - idx) * 1000,
            text
          }))
          useDashboardStore.setState({ logs: formattedLogs })
        }
        if (data.ai) s.setAiConfig(data.ai)
      })

      // Real-time status changes
      socket.on('status:change', (data) => {
        useDashboardStore.getState().setBotStatus(data.state, data.qr)
      })

      // Real-time hardware & bot execution metrics
      socket.on('metrics', (data) => {
        useDashboardStore.getState().updateMetrics(data)
      })

      // Real-time message observatory stream
      socket.on('message', (msg) => {
        useDashboardStore.getState().addMessage(msg)
        const s = useDashboardStore.getState()
        s.updateMetrics({ messagesToday: s.metrics.messagesToday + 1 })
      })

      // Real-time logger console stream
      socket.on('log', (logText) => {
        useDashboardStore.getState().addLog(logText)
      })

      // Real-time update triggers
      socket.on('commands:update', (list) => {
        useDashboardStore.getState().setCommandsList(list)
      })

      socket.on('groups:update', (list) => {
        useDashboardStore.getState().setGroupsList(list)
      })

      socket.on('users:update', (list) => {
        useDashboardStore.getState().setUsersList(list)
      })

      socket.on('db:tables_update', (list) => {
        useDashboardStore.getState().setDbTables(list)
      })

      socket.on('ai:update', (config) => {
        useDashboardStore.getState().setAiConfig(config)
      })
    } else {
      // If already connected, ensure the store reflects the connection status
      useDashboardStore.getState().setConnected(socket.connected)
    }
  }, [])

  const emit = (event: string, data?: any) => {
    socket?.emit(event, data)
  }

  return { emit, socket }
}
