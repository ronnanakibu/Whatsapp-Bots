// src/hooks/useSocket.ts
import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useDashboardStore } from '../store/dashboard'

export function useSocket() {
  const socketRef = useRef<Socket | null>(null)
  
  const {
    setConnected,
    setBotStatus,
    setUptime,
    updateMetrics,
    setAnalytics,
    addMessage,
    addLog,
    setCommandsList,
    setGroupsList,
    setUsersList,
    setAiConfig
  } = useDashboardStore()

  useEffect(() => {
    // Hardcode the remote Socket.IO host address
    const socketUrl = 'http://ap2.nzb.zelpstore.id:25637'
    
    console.log(`Connecting to WebSocket: ${socketUrl}`)
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      console.log('WebSocket connected')
      setConnected(true)
    })

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected')
      setConnected(false)
    })

    // Init data payload
    socket.on('init', (data) => {
      console.log('Received init payload', data)
      if (data.status) setBotStatus(data.status.state, data.status.qr)
      if (data.uptime) setUptime(data.uptime)
      if (data.metrics) updateMetrics(data.metrics)
      if (data.analytics) setAnalytics(data.analytics)
      if (data.commands) setCommandsList(data.commands)
      if (data.groups) setGroupsList(data.groups)
      if (data.users) setUsersList(data.users)
      if (data.ai) setAiConfig(data.ai)
    })

    // Real-time status changes
    socket.on('status:change', (data) => {
      setBotStatus(data.state, data.qr)
    })

    // Real-time hardware & bot execution metrics
    socket.on('metrics', (data) => {
      updateMetrics(data)
    })

    // Real-time message observatory stream
    socket.on('message', (msg) => {
      addMessage(msg)
      // Increment messages count in metrics
      updateMetrics({ messagesToday: useDashboardStore.getState().metrics.messagesToday + 1 })
    })

    // Real-time logger console stream
    socket.on('log', (logText) => {
      addLog(logText)
    })

    // Real-time update triggers
    socket.on('commands:update', (list) => {
      setCommandsList(list)
    })

    socket.on('groups:update', (list) => {
      setGroupsList(list)
    })

    socket.on('users:update', (list) => {
      setUsersList(list)
    })

    socket.on('ai:update', (config) => {
      setAiConfig(config)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  const emit = (event: string, data?: any) => {
    socketRef.current?.emit(event, data)
  }

  return { emit }
}
