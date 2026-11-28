// src/server/telemetry.js
// Truthful telemetry and data provenance builders for Control Center APIs & Socket.IO.
// Every metric exposes explicit provenance, unit, timestamp, and measured/unavailable state.

import { providerHealth, PROVIDER_CATALOG } from '../services/orchestrator/providerHealth.js'
import { redactSensitive } from './security/redaction.js'

/**
 * Wraps a measured numeric value with provenance metadata.
 * @param {number} value
 * @param {string} unit
 * @param {string} source
 * @param {number} [timestamp]
 */
export function measuredMetric(value, unit, source, timestamp = Date.now()) {
    return {
        value,
        unit,
        source,
        timestamp,
        measured: true
    }
}

/**
 * Represents a metric whose backing instrumentation is absent or unavailable.
 * Never fabricates a fallback number or substitutes zero.
 * @param {string} unit
 * @param {string} source
 * @param {string} unavailableReason
 */
export function unavailableMetric(unit, source, unavailableReason) {
    return {
        value: null,
        unit,
        source,
        timestamp: null,
        measured: false,
        unavailableReason
    }
}

/**
 * Queries real count of messages persisted today in SQLite `message_store`.
 * @param {import('better-sqlite3').Database|null} db
 */
export function getRealMessagesToday(db) {
    const source = 'sqlite:message_store'
    if (!db) {
        return unavailableMetric('messages', source, 'SQLite database offline')
    }
    try {
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        const startUnix = Math.floor(startOfDay.getTime() / 1000)
        const row = db.prepare('SELECT COUNT(*) as count FROM message_store WHERE created_at >= ?').get(startUnix)
        return measuredMetric(Number(row?.count ?? 0), 'messages', source, Date.now())
    } catch {
        return unavailableMetric('messages', source, 'message_store table unavailable')
    }
}

/**
 * Builds truthful AI provider telemetry directly from `providerHealth.js`.
 * Never exposes API keys, env var values, or provider secrets.
 */
export function buildAiProviderTelemetry() {
    const snapshot = providerHealth.getStatus()
    const providers = Object.entries(PROVIDER_CATALOG).map(([providerId, meta]) => {
        const status = snapshot.providers?.[providerId]
        const configured = Boolean(status?.isConfigured)
        const metrics = status?.metrics || {}
        const emaMs = metrics?.latency?.ema || 0
        const totalCalls = metrics?.totalCalls || 0
        const lastSuccessAt = metrics?.lastSuccessAt || null

        return {
            id: providerId,
            name: meta.name,
            tier: meta.tier,
            costTier: meta.costTier,
            contextWindow: meta.contextWindow,
            defaultModel: meta.defaultModel,
            configured,
            circuitState: configured ? (status?.state || 'UNKNOWN') : 'UNCONFIGURED',
            isAvailable: Boolean(configured && status?.isAvailable),
            emaLatency: emaMs > 0
                ? measuredMetric(emaMs, 'ms', 'orchestrator:providerHealth', lastSuccessAt || snapshot.timestamp)
                : unavailableMetric('ms', 'orchestrator:providerHealth', configured ? 'No completed calls recorded yet' : 'Provider not configured'),
            recentSuccessRate: totalCalls > 0
                ? measuredMetric(metrics.recentSuccessRatePercent, '%', 'orchestrator:providerHealth', snapshot.timestamp)
                : unavailableMetric('%', 'orchestrator:providerHealth', configured ? 'No calls recorded yet' : 'Provider not configured'),
            calls: {
                total: totalCalls,
                successes: metrics?.totalSuccesses || 0,
                failures: metrics?.totalFailures || 0,
                consecutiveErrors: metrics?.consecutiveErrors || 0,
                consecutiveRateLimits: metrics?.consecutiveRateLimits || 0
            },
            lastError: metrics?.lastError
                ? {
                    category: metrics.lastError.category,
                    statusCode: metrics.lastError.statusCode,
                    reason: redactSensitive(String(metrics.lastError.reason || '')),
                    timestamp: metrics.lastError.timestamp
                }
                : null,
            lastSuccessAt,
            lastFailureAt: metrics?.lastFailureAt || null,
            cooldownUntil: status?.cooldown?.isActive ? status.cooldown.until : null,
            circuitOpenUntil: status?.circuitOpen?.isActive ? status.circuitOpen.until : null
        }
    })

    const fallbackChain = providerHealth.getFallbackChain(1).map(c => c.provider)

    return {
        orchestratorStatus: 'experimental',
        enforcementScope: 'advisory',
        activeProvidersCount: snapshot.activeProvidersCount,
        totalCataloged: snapshot.totalCataloged,
        providers,
        fallbackChain,
        timestamp: snapshot.timestamp,
        source: 'orchestrator:providerHealth'
    }
}

/**
 * Builds complete Control Center metrics snapshot with explicit provenance per metric.
 */
export function buildControlMetricsSnapshot({
    db,
    metricsService,
    usersCount = null,
    groupsCount = null,
    dbSizeBytes = null
}) {
    const sys = metricsService.getSystemMetrics()
    const ana = metricsService.getAnalyticsData()
    const mem = process.memoryUsage()
    const healthSnap = providerHealth.getStatus()
    const now = sys.timestamp || Date.now()

    let totalAiCalls = 0
    for (const p of Object.values(healthSnap.providers || {})) {
        totalAiCalls += p?.metrics?.totalCalls || 0
    }

    return {
        timestamp: now,
        cpuUsage: measuredMetric(sys.cpuUsage, '%', 'os:cpus', now),
        memoryUsed: measuredMetric(sys.memoryUsed, 'MB', 'os:freemem', now),
        memoryTotal: measuredMetric(sys.memoryTotal, 'MB', 'os:totalmem', now),
        memoryUsagePercent: measuredMetric(sys.memoryUsage, '%', 'os:memory', now),
        processRss: measuredMetric(Math.round(mem.rss / 1024 / 1024), 'MB', 'process:memoryUsage', now),
        processHeapUsed: measuredMetric(Math.round(mem.heapUsed / 1024 / 1024), 'MB', 'process:memoryUsage', now),
        uptime: measuredMetric(Math.floor(process.uptime()), 'seconds', 'process:uptime', now),
        messagesToday: getRealMessagesToday(db),
        commandsExecuted: measuredMetric(ana.commandsToday, 'commands', 'metricsService:process_session', now),
        aiRequests: measuredMetric(totalAiCalls, 'requests', 'orchestrator:providerHealth', healthSnap.timestamp),
        downloads: measuredMetric(ana.downloadsToday, 'downloads', 'metricsService:process_session', now),
        activeStreams: measuredMetric(sys.activeStreams, 'streams', 'radioService:isPlaying', now),
        connectedListeners: measuredMetric(sys.connectedUsers, 'listeners', 'radioService:listenerCount', now),
        peakListeners: measuredMetric(ana.peakListeners, 'listeners', 'metricsService:process_session', now),
        queueSize: measuredMetric(sys.queueSize, 'tracks', 'radioService:queue', now),
        activeUsers: typeof usersCount === 'number'
            ? measuredMetric(usersCount, 'users', 'sqlite:users', now)
            : unavailableMetric('users', 'sqlite:users', 'User count not supplied'),
        activeGroups: typeof groupsCount === 'number'
            ? measuredMetric(groupsCount, 'groups', 'baileys+sqlite:chat_config', now)
            : unavailableMetric('groups', 'baileys+sqlite:chat_config', 'Group count not supplied'),
        dbSize: typeof dbSizeBytes === 'number'
            ? measuredMetric(dbSizeBytes, 'bytes', 'fs:statSync(main.db)', now)
            : unavailableMetric('bytes', 'fs:statSync(main.db)', 'Database file size unavailable'),
        networkHealth: unavailableMetric('status', 'telemetry', 'Active network latency probe not instrumented'),
        avgStreamDuration: unavailableMetric('seconds', 'radioService', 'Average stream duration aggregation not instrumented')
    }
}

/**
 * Builds truthful Control Center analytics snapshot.
 */
export function buildControlAnalyticsSnapshot({ metricsService }) {
    const ana = metricsService.getAnalyticsData()
    const healthSnap = providerHealth.getStatus()
    const now = Date.now()

    const aiCalls = Object.entries(healthSnap.providers || {}).map(([provider, st]) => ({
        provider,
        totalCalls: st?.metrics?.totalCalls || 0,
        successes: st?.metrics?.totalSuccesses || 0,
        failures: st?.metrics?.totalFailures || 0,
        measured: true
    }))

    return {
        timestamp: now,
        source: 'metricsService+providerHealth',
        hourlyMessageVolume: unavailableMetric('messages/hour', 'telemetry', 'Hourly message volume time-series not yet instrumented'),
        commandUsage: ana.topCommands,
        aiCalls
    }
}
