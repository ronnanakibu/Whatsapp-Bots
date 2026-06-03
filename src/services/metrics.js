// src/services/metrics.js
import os from 'os'
import { radioService } from './radio.js'

// Internal counters
let commandsCount = 0
let downloadsCount = 0
let waStatus = 'offline' // 'online' | 'offline' | 'connecting'
let peakListeners = 0
const commandUsages = {}

// CPU tracking variables
let lastCpuInfo = getCpuInfo()
let currentCpuUsage = 0

function getCpuInfo() {
    const cpus = os.cpus()
    if (!cpus || cpus.length === 0) return { idle: 0, total: 0 }
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0
    for (const cpu of cpus) {
        user += cpu.times.user
        nice += cpu.times.nice
        sys += cpu.times.sys
        idle += cpu.times.idle
        irq += cpu.times.irq
    }
    const total = user + nice + sys + idle + irq
    return { idle, total }
}

export function updateCpuUsage() {
    const current = getCpuInfo()
    const idleDiff = current.idle - lastCpuInfo.idle
    const totalDiff = current.total - lastCpuInfo.total
    if (totalDiff === 0) {
        currentCpuUsage = 0
    } else {
        currentCpuUsage = 100 - Math.floor((100 * idleDiff) / totalDiff)
    }
    lastCpuInfo = current
    return currentCpuUsage
}

// Memory tracking
export function getMemoryMetrics() {
    const total = os.totalmem()
    const free = os.freemem()
    const used = total - free
    const percent = total > 0 ? (used / total) * 100 : 0
    return {
        total: Math.round(total / (1024 * 1024)), // MB
        used: Math.round(used / (1024 * 1024)), // MB
        percent: Math.round(percent)
    }
}

// Metrics Service class
class MetricsService {
    constructor() {
        // Automatically start tracking cpu usage
        setInterval(() => {
            updateCpuUsage()
            // Track peak listeners
            const currentListeners = radioService.listenerCount
            if (currentListeners > peakListeners) {
                peakListeners = currentListeners
            }
        }, 3000)
    }

    incrementCommands(commandName) {
        commandsCount++
        if (commandName) {
            commandUsages[commandName] = (commandUsages[commandName] || 0) + 1
        }
    }

    incrementDownloads() {
        downloadsCount++
    }

    setWhatsAppStatus(status) {
        if (['online', 'offline', 'connecting'].includes(status)) {
            waStatus = status
        }
    }

    getWhatsAppStatus() {
        return waStatus
    }

    getSystemMetrics() {
        const mem = getMemoryMetrics()
        const isFfmpegOnline = radioService.isFfmpegActive
        
        return {
            status: waStatus === 'online' ? 'online' : 'offline',
            uptime: Math.floor(process.uptime()),
            cpuUsage: currentCpuUsage,
            memoryUsage: mem.percent,
            memoryTotal: mem.total,
            memoryUsed: mem.used,
            networkHealth: 'online', // Simple mock, server is obviously online if this is running
            waStatus: waStatus,
            ffmpegStatus: isFfmpegOnline ? 'online' : 'offline',
            activeStreams: radioService.isPlaying ? 1 : 0,
            connectedUsers: radioService.listenerCount,
            queueSize: radioService.queue.length,
            timestamp: Date.now(),
        }
    }

    getAnalyticsData() {
        const topCommands = Object.entries(commandUsages)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)

        // Fill defaults to prevent UI crash
        while (topCommands.length < 5) {
            topCommands.push({ name: '—', count: 0 })
        }

        return {
            commandsToday: commandsCount,
            downloadsToday: downloadsCount,
            streamsStarted: radioService.isPlaying ? 1 : 0, 
            peakListeners: peakListeners,
            activeUsers: radioService.listenerCount,
            topCommands,
            avgStreamDuration: '—',
        }
    }
}

export const metricsService = new MetricsService()
