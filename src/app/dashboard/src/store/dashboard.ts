// src/store/dashboard.ts
import { create } from 'zustand'

export type TabType = 
  | 'overview' 
  | 'messages' 
  | 'analytics' 
  | 'ai' 
  | 'groups' 
  | 'users' 
  | 'commands' 
  | 'downloader' 
  | 'moderation' 
  | 'memory' 
  | 'automations' 
  | 'logs' 
  | 'deployments' 
  | 'developer' 
  | 'settings'

export interface MessageLog {
  id: string
  timestamp: number
  sender: string
  type: string
  body: string
  isGroup: boolean
  chatId: string
}

export interface DevLog {
  id: string
  timestamp: number
  text: string
}

interface DashboardState {
  activeTab: TabType
  isConnected: boolean
  botStatus: 'connecting' | 'open' | 'close' | 'qr'
  qrCode: string | null
  uptime: number
  metrics: {
    cpuUsage: number
    memoryUsage: number
    totalMemory: number
    messagesToday: number
    commandsExecuted: number
    aiRequests: number
    downloads: number
    activeUsers: number
    activeGroups: number
    dbSize: number
  }
  analytics: {
    hourlyMessageVolume: number[]
    commandUsage: { name: string; count: number }[]
    aiCalls: { provider: string; count: number }[]
  }
  messages: MessageLog[]
  logs: DevLog[]
  commandsList: any[]
  groupsList: any[]
  usersList: any[]
  dbTables: string[]
  aiConfig: {
    providers: any[]
    fallbackChain: string[]
  }
  
  // Setters
  setActiveTab: (tab: TabType) => void
  setConnected: (connected: boolean) => void
  setBotStatus: (status: 'connecting' | 'open' | 'close' | 'qr', qr?: string | null) => void
  setUptime: (uptime: number) => void
  updateMetrics: (metrics: Partial<DashboardState['metrics']>) => void
  setAnalytics: (analytics: DashboardState['analytics']) => void
  addMessage: (msg: Omit<MessageLog, 'id' | 'timestamp'>) => void
  addLog: (text: string) => void
  setCommandsList: (list: any[]) => void
  setGroupsList: (list: any[]) => void
  setUsersList: (list: any[]) => void
  setDbTables: (tables: string[]) => void
  setAiConfig: (config: DashboardState['aiConfig']) => void
}

export const useDashboardStore = create<DashboardState>((set) => ({
  activeTab: 'overview',
  isConnected: false,
  botStatus: 'connecting',
  qrCode: null,
  uptime: 0,
  metrics: {
    cpuUsage: 0,
    memoryUsage: 0,
    totalMemory: 1,
    messagesToday: 0,
    commandsExecuted: 0,
    aiRequests: 0,
    downloads: 0,
    activeUsers: 0,
    activeGroups: 0,
    dbSize: 0,
  },
  analytics: {
    hourlyMessageVolume: Array(24).fill(0),
    commandUsage: [],
    aiCalls: [],
  },
  messages: [],
  logs: [],
  commandsList: [],
  groupsList: [],
  usersList: [],
  dbTables: [],
  aiConfig: {
    providers: [],
    fallbackChain: ['nvidia', 'groq', 'gemini']
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setConnected: (connected) => set({ isConnected: connected }),
  setBotStatus: (status, qr = null) => set({ botStatus: status, qrCode: qr }),
  setUptime: (uptime) => set({ uptime }),
  updateMetrics: (newMetrics) => set((state) => ({ metrics: { ...state.metrics, ...newMetrics } })),
  setAnalytics: (analytics) => set({ analytics }),
  addMessage: (msg) => set((state) => {
    const newMsg: MessageLog = {
      ...msg,
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now()
    }
    const updated = [newMsg, ...state.messages]
    if (updated.length > 100) updated.pop()
    return { messages: updated }
  }),
  addLog: (text) => set((state) => {
    const newLog: DevLog = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      text
    }
    const updated = [newLog, ...state.logs]
    if (updated.length > 200) updated.pop()
    return { logs: updated }
  }),
  setCommandsList: (list) => set({ commandsList: list }),
  setGroupsList: (list) => set({ groupsList: list }),
  setUsersList: (list) => set({ usersList: list }),
  setDbTables: (tables) => set({ dbTables: tables }),
  setAiConfig: (config) => set({ aiConfig: config })
}))
