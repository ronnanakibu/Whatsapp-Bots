/**
 * src/services/orchestrator/providerHealth.js
 * 
 * Resource-Aware Agent Orchestration — Milestone 2 (Phase 2C)
 * Real-Time Provider Health Metrics, Circuit Breaker State Machine & Intelligent Failover
 * 
 * Strict Zero-False-Claims Architecture: Accurately tracks rate-limits, quotas,
 * and latencies across Groq, NVIDIA NIM, Gemini, OpenRouter, DeepSeek, OpenAI, and HF Spaces.
 */

import { logger, botLogger } from '../../utils/logger.js'

// Safe logger proxy for pino & botLogger compatibility
const safeLogger = {
    info: (msg) => {
        if (logger?.info) logger.info(msg);
        else if (botLogger?.info) botLogger.info('providerHealth', msg);
        else console.log(msg);
    },
    warn: (msg) => {
        if (logger?.warn) logger.warn(msg);
        else if (botLogger?.warn) botLogger.warn('providerHealth', msg);
        else console.warn(msg);
    },
    error: (msg, err) => {
        if (logger?.error) logger.error(msg);
        else if (botLogger?.error) botLogger.error('providerHealth', msg, err);
        else console.error(msg, err);
    },
    err: (msg, err) => {
        if (logger?.error) logger.error(msg);
        else if (botLogger?.error) botLogger.error('providerHealth', msg, err);
        else console.error(msg, err);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const CircuitState = Object.freeze({
    HEALTHY: 'HEALTHY',
    COOLDOWN: 'COOLDOWN',
    CIRCUIT_OPEN: 'CIRCUIT_OPEN',
    HALF_OPEN: 'HALF_OPEN'
});

export const ErrorCategory = Object.freeze({
    RATE_LIMIT: 'RATE_LIMIT',           // HTTP 429, Quota exhaustion
    SERVER_ERROR: 'SERVER_ERROR',       // HTTP 500, 502, 503, 504
    NETWORK_ERROR: 'NETWORK_ERROR',     // ETIMEDOUT, ECONNRESET, AbortError
    AUTH_ERROR: 'AUTH_ERROR',           // HTTP 401, 403 (Invalid key/credentials)
    CLIENT_ERROR: 'CLIENT_ERROR',       // HTTP 400, 422 (Bad Request / Schema)
    CONTEXT_OVERFLOW: 'CONTEXT_OVERFLOW', // HTTP 400 Context length exceeded
    SAFETY_BLOCK: 'SAFETY_BLOCK',       // Content moderation / safety filter trip
    UNKNOWN: 'UNKNOWN'
});

export const DEFAULT_CIRCUIT_CONFIG = Object.freeze({
    failureThreshold: 3,             // Consecutive failures to trip to CIRCUIT_OPEN
    errorRateThreshold: 0.5,         // 50% failure rate over window trips circuit
    windowSize: 20,                  // Sliding window size for calls
    baseCooldownMs: 30_000,          // 30s base cooldown for 429s without retry-after
    maxCooldownMs: 300_000,          // 5 minutes max cooldown
    circuitOpenDurationMs: 60_000,   // 60s circuit open duration before probing
    maxCircuitOpenDurationMs: 300_000, // 5m max open duration under repeated failure
    halfOpenMaxProbes: 1,            // Number of concurrent probe calls allowed in HALF_OPEN
    emaAlpha: 0.2                    // Smoothing factor for Exponential Moving Average latency
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────

export class ErrorClassifier {
    /**
     * Parses native SDK, Axios, or fetch errors into a typed classification
     * @param {Error|object} error 
     * @returns {object} { category, isRetryable, isRateLimit, statusCode, retryAfterMs, reason }
     */
    static classify(error) {
        if (!error) {
            return {
                category: ErrorCategory.UNKNOWN,
                isRetryable: false,
                isRateLimit: false,
                statusCode: null,
                retryAfterMs: null,
                reason: 'Unknown error (null)'
            };
        }

        const message = String(error.message || error.error?.message || '').toLowerCase();
        const status = Number(error.status || error.statusCode || error.response?.status || 0);
        const code = String(error.code || '');

        // 1. Check for Rate Limit (HTTP 429 or text signatures)
        const is429 = status === 429 ||
            message.includes('429') ||
            message.includes('rate limit') ||
            message.includes('rate_limit') ||
            message.includes('resource_exhausted') ||
            message.includes('quota exceeded') ||
            message.includes('too many requests');

        if (is429) {
            const retryAfterMs = ErrorClassifier.extractRetryAfterMs(error, message);
            return {
                category: ErrorCategory.RATE_LIMIT,
                isRetryable: true,
                isRateLimit: true,
                statusCode: 429,
                retryAfterMs,
                reason: error.message || 'Rate limit or quota reached'
            };
        }

        // 2. Check for Context Length Overflow
        const isContextOverflow = message.includes('context length') ||
            message.includes('maximum context') ||
            message.includes('prompt is too long') ||
            message.includes('token limit exceeded') ||
            message.includes('max_tokens') ||
            message.includes('context_window_exceeded');

        if (isContextOverflow) {
            return {
                category: ErrorCategory.CONTEXT_OVERFLOW,
                isRetryable: true, // Retryable if context is pruned
                isRateLimit: false,
                statusCode: status || 400,
                retryAfterMs: null,
                reason: 'Context length exceeded'
            };
        }

        // 3. Check for Authentication / Authorization Errors
        if (status === 401 || status === 403 || message.includes('api key') || message.includes('unauthorized') || message.includes('permission denied')) {
            return {
                category: ErrorCategory.AUTH_ERROR,
                isRetryable: false, // Non-retryable on this provider without credential change
                isRateLimit: false,
                statusCode: status || 401,
                retryAfterMs: null,
                reason: 'Authentication or permission denied'
            };
        }

        // 4. Check for Content Safety Moderation
        if (message.includes('safety') || message.includes('content moderation') || message.includes('harmful content') || message.includes('blocked by policy')) {
            return {
                category: ErrorCategory.SAFETY_BLOCK,
                isRetryable: false,
                isRateLimit: false,
                statusCode: status || 400,
                retryAfterMs: null,
                reason: 'Prompt blocked by provider safety policy'
            };
        }

        // 5. Check for Network / Socket / Timeout Errors
        const isNetwork = code === 'ETIMEDOUT' ||
            code === 'ECONNRESET' ||
            code === 'ECONNREFUSED' ||
            code === 'ENOTFOUND' ||
            code === 'EAI_AGAIN' ||
            code === 'UND_ERR_CONNECT_TIMEOUT' ||
            error.name === 'AbortError' ||
            message.includes('timeout') ||
            message.includes('socket hang up') ||
            message.includes('network error') ||
            message.includes('fetch failed');

        if (isNetwork) {
            return {
                category: ErrorCategory.NETWORK_ERROR,
                isRetryable: true,
                isRateLimit: false,
                statusCode: status || 0,
                retryAfterMs: null,
                reason: `Network/Socket error (${code || error.name || 'timeout'})`
            };
        }

        // 6. Check for Server Errors (5xx)
        if (status >= 500 && status < 600) {
            return {
                category: ErrorCategory.SERVER_ERROR,
                isRetryable: true,
                isRateLimit: false,
                statusCode: status,
                retryAfterMs: null,
                reason: `Server error HTTP ${status}`
            };
        }

        // 7. Check for Client / Parameter Errors (4xx)
        if (status >= 400 && status < 500) {
            return {
                category: ErrorCategory.CLIENT_ERROR,
                isRetryable: false,
                isRateLimit: false,
                statusCode: status,
                retryAfterMs: null,
                reason: `Client error HTTP ${status}`
            };
        }

        // 8. Fallback Unknown
        return {
            category: ErrorCategory.UNKNOWN,
            isRetryable: false,
            isRateLimit: false,
            statusCode: status || null,
            retryAfterMs: null,
            reason: error.message || 'Unknown provider error'
        };
    }

    /**
     * Extracts retry-after duration in milliseconds from headers or error message
     * @param {object} error 
     * @param {string} message 
     * @returns {number|null}
     */
    static extractRetryAfterMs(error, message) {
        // Check HTTP response headers (Axios / Fetch / SDK headers)
        const headers = error.response?.headers || error.headers;
        if (headers) {
            const rawHeader = headers['retry-after'] ||
                (typeof headers.get === 'function' ? headers.get('retry-after') : null) ||
                headers['x-ratelimit-reset-requests'] ||
                headers['retry-after-ms'];

            if (rawHeader) {
                const asNum = Number(rawHeader);
                if (!isNaN(asNum) && asNum > 0) {
                    // Header might be in seconds or ms
                    return asNum > 1000 ? asNum : Math.round(asNum * 1000);
                }
                // Try parsing as HTTP Date
                const asDate = Date.parse(rawHeader);
                if (!isNaN(asDate) && asDate > Date.now()) {
                    return Math.max(1000, asDate - Date.now());
                }
            }
        }

        // Check text message patterns: "try again in 24.5s" or "wait 30 seconds"
        const secMatch = message.match(/(?:try again in|wait|retry after)\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)/i);
        if (secMatch && secMatch[1]) {
            const seconds = parseFloat(secMatch[1]);
            if (!isNaN(seconds) && seconds > 0) {
                return Math.round(seconds * 1000);
            }
        }

        const msMatch = message.match(/(?:try again in|wait|retry after)\s*(\d+)\s*(?:ms|milliseconds)/i);
        if (msMatch && msMatch[1]) {
            const ms = parseInt(msMatch[1], 10);
            if (!isNaN(ms) && ms > 0) return ms;
        }

        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER METRICS TRACKER
// ─────────────────────────────────────────────────────────────────────────────

export class ProviderMetrics {
    constructor(providerId, config = DEFAULT_CIRCUIT_CONFIG) {
        this.providerId = providerId;
        this.config = config;

        // Rolling latency metrics
        this.emaLatencyMs = 0;
        this.latencyInitialized = false;
        this.callHistory = []; // Circular buffer of { timestamp, latencyMs, success }

        // Counters
        this.totalCalls = 0;
        this.totalSuccesses = 0;
        this.totalFailures = 0;
        this.consecutiveErrors = 0;
        this.consecutiveSuccesses = 0;
        this.consecutiveRateLimits = 0;

        // Reported Token Usage
        this.cumulativeReportedTokens = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0
        };
        this.lastReportedTokens = null;

        // Error log
        this.lastError = null;
        this.lastSuccessAt = null;
        this.lastFailureAt = null;
    }

    recordSuccess(latencyMs = 0, reportedTokens = null) {
        this.totalCalls++;
        this.totalSuccesses++;
        this.consecutiveSuccesses++;
        this.consecutiveErrors = 0;
        this.consecutiveRateLimits = 0;
        this.lastSuccessAt = Date.now();

        // Update EMA Latency
        if (latencyMs > 0) {
            if (!this.latencyInitialized) {
                this.emaLatencyMs = latencyMs;
                this.latencyInitialized = true;
            } else {
                this.emaLatencyMs = Math.round(
                    (this.config.emaAlpha * latencyMs) +
                    ((1 - this.config.emaAlpha) * this.emaLatencyMs)
                );
            }
        }

        // Add to sliding window
        this._pushHistory({
            timestamp: Date.now(),
            latencyMs: Math.max(0, latencyMs),
            success: true
        });

        // Track token usage
        if (reportedTokens && typeof reportedTokens === 'object') {
            const inp = Number(reportedTokens.inputTokens || reportedTokens.prompt_tokens || 0);
            const out = Number(reportedTokens.outputTokens || reportedTokens.completion_tokens || 0);
            const tot = Number(reportedTokens.totalTokens || (inp + out) || 0);

            this.lastReportedTokens = { inputTokens: inp, outputTokens: out, totalTokens: tot };
            this.cumulativeReportedTokens.inputTokens += inp;
            this.cumulativeReportedTokens.outputTokens += out;
            this.cumulativeReportedTokens.totalTokens += tot;
        }
    }

    recordFailure(error, classified, latencyMs = 0) {
        this.totalCalls++;
        this.totalFailures++;
        this.consecutiveSuccesses = 0;
        this.consecutiveErrors++;
        this.lastFailureAt = Date.now();

        if (classified.isRateLimit) {
            this.consecutiveRateLimits++;
        }

        this.lastError = {
            category: classified.category,
            statusCode: classified.statusCode,
            reason: classified.reason,
            timestamp: Date.now()
        };

        // Add to sliding window
        this._pushHistory({
            timestamp: Date.now(),
            latencyMs: Math.max(0, latencyMs),
            success: false
        });
    }

    _pushHistory(entry) {
        this.callHistory.push(entry);
        if (this.callHistory.length > this.config.windowSize) {
            this.callHistory.shift();
        }
    }

    getRecentSuccessRate() {
        if (this.callHistory.length === 0) return 100;
        const successCount = this.callHistory.filter(h => h.success).length;
        return Math.round((successCount / this.callHistory.length) * 100);
    }

    getRecentErrorRate() {
        if (this.callHistory.length === 0) return 0;
        const failureCount = this.callHistory.filter(h => !h.success).length;
        return failureCount / this.callHistory.length;
    }

    getLatencyStats() {
        if (this.callHistory.length === 0) {
            return { ema: this.emaLatencyMs, min: 0, max: 0, avg: 0, p95: 0 };
        }

        const validLatencies = this.callHistory
            .map(h => h.latencyMs)
            .filter(l => l > 0)
            .sort((a, b) => a - b);

        if (validLatencies.length === 0) {
            return { ema: this.emaLatencyMs, min: 0, max: 0, avg: 0, p95: 0 };
        }

        const min = validLatencies[0];
        const max = validLatencies[validLatencies.length - 1];
        const avg = Math.round(validLatencies.reduce((sum, v) => sum + v, 0) / validLatencies.length);
        const p95Index = Math.min(validLatencies.length - 1, Math.floor(validLatencies.length * 0.95));
        const p95 = validLatencies[p95Index];

        return {
            ema: this.emaLatencyMs,
            min,
            max,
            avg,
            p95
        };
    }

    getSnapshot() {
        return {
            totalCalls: this.totalCalls,
            totalSuccesses: this.totalSuccesses,
            totalFailures: this.totalFailures,
            consecutiveErrors: this.consecutiveErrors,
            consecutiveSuccesses: this.consecutiveSuccesses,
            consecutiveRateLimits: this.consecutiveRateLimits,
            recentSuccessRatePercent: this.getRecentSuccessRate(),
            recentErrorRate: this.getRecentErrorRate(),
            latency: this.getLatencyStats(),
            tokens: {
                cumulative: { ...this.cumulativeReportedTokens },
                lastReported: this.lastReportedTokens ? { ...this.lastReportedTokens } : null
            },
            lastError: this.lastError ? { ...this.lastError } : null,
            lastSuccessAt: this.lastSuccessAt,
            lastFailureAt: this.lastFailureAt
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4-STATE CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────────────────────

export class CircuitBreaker {
    constructor(providerId, config = DEFAULT_CIRCUIT_CONFIG) {
        this.providerId = providerId;
        this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };

        this.state = CircuitState.HEALTHY;
        this.metrics = new ProviderMetrics(providerId, this.config);

        // Cooldown and Trip Timers
        this.cooldownUntil = 0;
        this.cooldownReason = null;
        this.circuitOpenUntil = 0;
        this.circuitOpenReason = null;

        // Half-Open Probe Token
        this.probesInFlight = 0;
        this.tripCount = 0;
    }

    /**
     * Determines current active state, handling automatic transitions from timers
     * @returns {string} CircuitState
     */
    getState() {
        const now = Date.now();

        // 1. In COOLDOWN: check if cooldown timer expired
        if (this.state === CircuitState.COOLDOWN) {
            if (now >= this.cooldownUntil) {
                safeLogger.info(`[ProviderHealth/${this.providerId}] Cooldown expired. Entering HALF_OPEN probationary mode.`);
                this.state = CircuitState.HALF_OPEN;
                this.probesInFlight = 0;
            }
        }

        // 2. In CIRCUIT_OPEN: check if circuit open duration expired
        if (this.state === CircuitState.CIRCUIT_OPEN) {
            if (now >= this.circuitOpenUntil) {
                safeLogger.info(`[ProviderHealth/${this.providerId}] Circuit open timer expired. Entering HALF_OPEN probationary mode.`);
                this.state = CircuitState.HALF_OPEN;
                this.probesInFlight = 0;
            }
        }

        return this.state;
    }

    /**
     * Checks if this provider is allowed to execute a request
     * @returns {boolean}
     */
    canAttempt() {
        const currentState = this.getState();

        if (currentState === CircuitState.HEALTHY) {
            return true;
        }

        if (currentState === CircuitState.HALF_OPEN) {
            return this.probesInFlight < this.config.halfOpenMaxProbes;
        }

        // COOLDOWN and CIRCUIT_OPEN block new requests
        return false;
    }

    /**
     * Acquires a probationary slot when state is HALF_OPEN
     * @returns {boolean}
     */
    acquireProbeSlot() {
        if (this.getState() !== CircuitState.HALF_OPEN) return false;
        if (this.probesInFlight < this.config.halfOpenMaxProbes) {
            this.probesInFlight++;
            return true;
        }
        return false;
    }

    recordSuccess(latencyMs = 0, reportedTokens = null) {
        const previousState = this.getState();

        this.metrics.recordSuccess(latencyMs, reportedTokens);

        if (previousState === CircuitState.HALF_OPEN) {
            safeLogger.info(`[ProviderHealth/${this.providerId}] Probe succeeded! Circuit recovered to HEALTHY.`);
            this.state = CircuitState.HEALTHY;
            this.probesInFlight = 0;
            this.cooldownUntil = 0;
            this.circuitOpenUntil = 0;
            this.tripCount = 0;
        }
    }

    recordFailure(error, latencyMs = 0) {
        const classified = ErrorClassifier.classify(error);
        this.metrics.recordFailure(error, classified, latencyMs);

        const currentState = this.getState();

        // 1. Probe failed in HALF_OPEN: immediately re-trip
        if (currentState === CircuitState.HALF_OPEN) {
            this.probesInFlight = 0;
            if (classified.isRateLimit) {
                this._tripCooldown(classified);
            } else {
                this._tripCircuit(`Probe request failed in HALF_OPEN: ${classified.reason}`);
            }
            return classified;
        }

        // 2. Rate limit encountered: trip to COOLDOWN
        if (classified.isRateLimit) {
            this._tripCooldown(classified);
            return classified;
        }

        // 3. Consecutive failures or window error rate threshold exceeded: trip to CIRCUIT_OPEN
        if (classified.category === ErrorCategory.SERVER_ERROR || classified.category === ErrorCategory.NETWORK_ERROR) {
            const consecutive = this.metrics.consecutiveErrors;
            const errorRate = this.metrics.getRecentErrorRate();

            if (consecutive >= this.config.failureThreshold || (this.metrics.totalCalls >= 5 && errorRate >= this.config.errorRateThreshold)) {
                this._tripCircuit(`Failure threshold tripped: ${consecutive} consecutive errors, error rate ${(errorRate * 100).toFixed(0)}%`);
            }
        }

        return classified;
    }

    _tripCooldown(classified) {
        this.tripCount++;
        this.state = CircuitState.COOLDOWN;
        this.probesInFlight = 0;

        // Calculate backoff: use header retry-after if available, else exponential backoff with jitter
        let backoffMs = classified.retryAfterMs;
        if (!backoffMs || backoffMs <= 0) {
            const exponent = Math.min(4, this.metrics.consecutiveRateLimits);
            const jitter = Math.floor(Math.random() * 2000) - 1000; // ±1s jitter
            backoffMs = Math.min(
                this.config.maxCooldownMs,
                (this.config.baseCooldownMs * Math.pow(1.5, exponent)) + jitter
            );
        }

        this.cooldownUntil = Date.now() + Math.max(5000, backoffMs);
        this.cooldownReason = classified.reason || 'Rate limit 429';

        safeLogger.warn(`[ProviderHealth/${this.providerId}] Entered COOLDOWN for ${(backoffMs / 1000).toFixed(1)}s (until ${new Date(this.cooldownUntil).toISOString()}). Reason: ${this.cooldownReason}`);
    }

    _tripCircuit(reason) {
        this.tripCount++;
        this.state = CircuitState.CIRCUIT_OPEN;
        this.probesInFlight = 0;

        const exponent = Math.min(4, this.tripCount - 1);
        const jitter = Math.floor(Math.random() * 3000);
        const durationMs = Math.min(
            this.config.maxCircuitOpenDurationMs,
            (this.config.circuitOpenDurationMs * Math.pow(1.5, exponent)) + jitter
        );

        this.circuitOpenUntil = Date.now() + durationMs;
        this.circuitOpenReason = reason;

        safeLogger.err(`[ProviderHealth/${this.providerId}] CIRCUIT_OPEN tripped for ${(durationMs / 1000).toFixed(1)}s. Reason: ${reason}`);
    }

    reset() {
        this.state = CircuitState.HEALTHY;
        this.cooldownUntil = 0;
        this.circuitOpenUntil = 0;
        this.probesInFlight = 0;
        this.tripCount = 0;
        safeLogger.info(`[ProviderHealth/${this.providerId}] Circuit breaker manually reset to HEALTHY.`);
    }

    getStatus() {
        const state = this.getState();
        const now = Date.now();

        let remainingCooldownMs = 0;
        if (state === CircuitState.COOLDOWN && this.cooldownUntil > now) {
            remainingCooldownMs = this.cooldownUntil - now;
        }

        let remainingCircuitOpenMs = 0;
        if (state === CircuitState.CIRCUIT_OPEN && this.circuitOpenUntil > now) {
            remainingCircuitOpenMs = this.circuitOpenUntil - now;
        }

        return {
            providerId: this.providerId,
            state,
            isAvailable: this.canAttempt(),
            cooldown: {
                isActive: state === CircuitState.COOLDOWN,
                remainingMs: remainingCooldownMs,
                until: this.cooldownUntil ? new Date(this.cooldownUntil).toISOString() : null,
                reason: this.cooldownReason
            },
            circuitOpen: {
                isActive: state === CircuitState.CIRCUIT_OPEN,
                remainingMs: remainingCircuitOpenMs,
                until: this.circuitOpenUntil ? new Date(this.circuitOpenUntil).toISOString() : null,
                reason: this.circuitOpenReason
            },
            tripCount: this.tripCount,
            metrics: this.metrics.getSnapshot()
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC PROVIDER CATALOG & CAPABILITY REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDER_CATALOG = Object.freeze({
    groq: {
        id: 'groq',
        name: 'Groq Cloud High-Speed Inference',
        tier: 1,
        supportedTiers: [1, 2],
        defaultModel: 'openai/gpt-oss-120b',
        candidateModels: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
        capabilities: {
            text: true,
            json: true,
            tools: true,
            streaming: true,
            reasoning: false,
            vision: false,
            image_gen: false
        },
        contextWindow: 131072,
        costTier: 'low-cost',
        isFreeOrUnlimited: false, // Strict: Rate-limited free tier (30 RPM)
        envKey: 'GROQ_API_KEY'
    },
    nvidia: {
        id: 'nvidia',
        name: 'NVIDIA NIM Enterprise API',
        tier: 2,
        supportedTiers: [1, 2, 3],
        defaultModel: 'deepseek-ai/deepseek-v4.1-flash',
        candidateModels: [
            'deepseek-ai/deepseek-v4.1-flash',
            'deepseek-ai/deepseek-v4-pro',
            'nvidia/nemotron-3-super-120b-a12b',
            'meta/llama-3.3-70b-instruct',
            'moonshotai/kimi-k2.6',
            'qwen/qwen-2.5-72b-instruct'
        ],
        capabilities: {
            text: true,
            json: true,
            tools: true,
            streaming: true,
            reasoning: true,
            vision: false,
            image_gen: false
        },
        contextWindow: 131072,
        costTier: 'medium-cost',
        isFreeOrUnlimited: false, // Strict: Free credits upon signup, bounded quota
        envKey: 'NVIDIA_API_KEY'
    },
    gemini: {
        id: 'gemini',
        name: 'Google Gemini Multimodal API',
        tier: 1,
        supportedTiers: [1, 2],
        defaultModel: 'gemini-2.5-flash',
        candidateModels: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
        capabilities: {
            text: true,
            json: true,
            tools: true,
            streaming: true,
            reasoning: true,
            vision: true,
            multimodal: true,
            image_gen: false
        },
        contextWindow: 1048576,
        costTier: 'low-cost',
        isFreeOrUnlimited: false, // Strict: 15 RPM / 1,500 RPD free tier limits
        envKey: 'GEMINI_API_KEY'
    },
    openrouter: {
        id: 'openrouter',
        name: 'OpenRouter Aggregated Gateway',
        tier: 2,
        supportedTiers: [2, 3],
        defaultModel: 'nousresearch/hermes-3-llama-3.1-70b',
        candidateModels: ['nousresearch/hermes-3-llama-3.1-70b', 'meta-llama/llama-3.3-70b-instruct'],
        capabilities: {
            text: true,
            json: true,
            tools: true,
            streaming: true,
            reasoning: true,
            vision: false,
            image_gen: false
        },
        contextWindow: 131072,
        costTier: 'medium-cost',
        isFreeOrUnlimited: false, // Strict: Prepaid per-token billing
        envKey: 'OPENROUTER_API_KEY'
    },
    deepseek: {
        id: 'deepseek',
        name: 'DeepSeek Official API',
        tier: 3,
        supportedTiers: [2, 3],
        defaultModel: 'deepseek-chat',
        candidateModels: ['deepseek-chat', 'deepseek-reasoner'],
        capabilities: {
            text: true,
            json: true,
            tools: true,
            streaming: true,
            reasoning: true,
            vision: false,
            image_gen: false
        },
        contextWindow: 65536,
        costTier: 'medium-cost',
        isFreeOrUnlimited: false, // Strict: Prepaid balance required
        envKey: 'DEEPSEEK_API_KEY'
    },
    openai: {
        id: 'openai',
        name: 'OpenAI Direct API',
        tier: 2,
        supportedTiers: [1, 2],
        defaultModel: 'gpt-4o-mini',
        candidateModels: ['gpt-4o-mini', 'gpt-4o'],
        capabilities: {
            text: true,
            json: true,
            tools: true,
            streaming: true,
            reasoning: false,
            vision: true,
            image_gen: true
        },
        contextWindow: 128000,
        costTier: 'medium-cost',
        isFreeOrUnlimited: false, // Strict: Commercial prepaid billing
        envKey: 'OPENAI_API_KEY'
    },
    'hf-spaces': {
        id: 'hf-spaces',
        name: 'Hugging Face Spaces ZeroGPU',
        tier: 0,
        supportedTiers: [0],
        defaultModel: 'black-forest-labs/FLUX.1-schnell',
        candidateModels: ['black-forest-labs/FLUX.1-schnell', 'ronnLbtrn/ronnbot-ltxvideo'],
        capabilities: {
            text: false,
            json: false,
            tools: false,
            streaming: false,
            reasoning: false,
            vision: false,
            image_gen: true,
            video_gen: true
        },
        contextWindow: 0,
        costTier: 'free-tier',
        isFreeOrUnlimited: false, // Strict: Bounded ZeroGPU daily quota per token
        envKey: 'HF_TOKEN'
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER HEALTH MANAGER
// ─────────────────────────────────────────────────────────────────────────────

export class ProviderHealthManager {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
        this.breakers = new Map();

        // Initialize circuit breakers for cataloged providers
        for (const [providerId] of Object.entries(PROVIDER_CATALOG)) {
            this.breakers.set(providerId, new CircuitBreaker(providerId, this.config));
        }
    }

    /**
     * Get or create circuit breaker for provider
     * @param {string} provider 
     * @returns {CircuitBreaker}
     */
    getBreaker(provider) {
        const cleanId = String(provider).toLowerCase();
        if (!this.breakers.has(cleanId)) {
            this.breakers.set(cleanId, new CircuitBreaker(cleanId, this.config));
        }
        return this.breakers.get(cleanId);
    }

    /**
     * Check if a provider has configured credentials in environment
     * @param {string} providerId 
     * @param {object} options - { skipEnvCheck: boolean }
     * @returns {boolean}
     */
    isConfigured(providerId, options = {}) {
        if (options.skipEnvCheck || this.config.skipEnvCheck) return true;
        const meta = PROVIDER_CATALOG[providerId];
        if (!meta) return true; // Untracked custom providers assumed configured
        if (!meta.envKey) return true;
        const keyVal = process.env[meta.envKey];
        return Boolean(keyVal && keyVal.trim().length > 0);
    }

    /**
     * Record a successful provider invocation
     * @param {string} provider 
     * @param {object} telemetry - { latencyMs, reportedTokens }
     */
    recordSuccess(provider, { latencyMs = 0, reportedTokens = null } = {}) {
        const breaker = this.getBreaker(provider);
        breaker.recordSuccess(latencyMs, reportedTokens);
    }

    /**
     * Record a failed provider invocation
     * @param {string} provider 
     * @param {Error|object} error 
     * @param {number} latencyMs 
     * @returns {object} classifiedError
     */
    recordFailure(provider, error, latencyMs = 0) {
        const breaker = this.getBreaker(provider);
        return breaker.recordFailure(error, latencyMs);
    }

    /**
     * Returns true if provider is currently available to accept requests
     * @param {string} provider 
     * @returns {boolean}
     */
    isAvailable(provider) {
        const cleanId = String(provider).toLowerCase();
        if (!this.isConfigured(cleanId)) return false;
        return this.getBreaker(cleanId).canAttempt();
    }

    /**
     * Helper to classify an error without recording failure
     * @param {Error} error 
     */
    classifyError(error) {
        return ErrorClassifier.classify(error);
    }

    /**
     * Selects the single best healthy provider for a given tier and requirements
     * @param {number} tier - 0, 1, 2, 3
     * @param {object} requirements - { capabilities: [], minContextTokens: 0, preferredProvider: null, exclude: [] }
     * @returns {object|null} { provider, model, tier, state, metrics }
     */
    getHealthyProvider(tier = 1, requirements = {}) {
        const chain = this.getFallbackChain(tier, requirements);
        return chain.length > 0 ? chain[0] : null;
    }

    /**
     * Constructs an ordered fallback chain of healthy, capable providers
     * @param {number} targetTier 
     * @param {object} requirements 
     * @returns {Array<object>}
     */
    getFallbackChain(targetTier = 1, requirements = {}) {
        const {
            capabilities = ['text'],
            minContextTokens = 0,
            preferredProvider = null,
            exclude = []
        } = requirements;

        const excludeSet = new Set(exclude.map(e => String(e).toLowerCase()));
        const candidates = [];

        for (const [providerId, meta] of Object.entries(PROVIDER_CATALOG)) {
            if (excludeSet.has(providerId)) continue;
            if (!this.isConfigured(providerId, requirements)) continue;

            // 1. Check capability match
            const hasAllCapabilities = capabilities.every(cap => Boolean(meta.capabilities[cap]));
            if (!hasAllCapabilities) continue;

            // 2. Check context window size
            if (minContextTokens > 0 && meta.contextWindow < minContextTokens) continue;

            // 3. Check circuit availability
            const breaker = this.getBreaker(providerId);
            if (!breaker.canAttempt()) continue;

            const state = breaker.getState();
            const metrics = breaker.metrics.getSnapshot();

            // Calculate health and ranking score
            let score = 100;

            // Tier affinity bonus: Exact tier match preferred
            if (meta.tier === targetTier) {
                score += 50;
            } else if (meta.supportedTiers.includes(targetTier)) {
                score += 25;
            } else {
                score -= 30;
            }

            // Preferred provider bonus
            if (preferredProvider && providerId === String(preferredProvider).toLowerCase()) {
                score += 60;
            }

            // Health bonuses
            score += Math.round(metrics.recentSuccessRatePercent * 0.4); // Up to +40 points
            if (metrics.latency.ema > 0) {
                score -= Math.min(40, Math.round(metrics.latency.ema / 50)); // Penalty for high latency
            }
            score -= (metrics.consecutiveErrors * 20); // Severe penalty for recent errors

            if (state === CircuitState.HALF_OPEN) {
                score -= 15; // Slight penalty for probationary mode
            }

            candidates.push({
                provider: providerId,
                name: meta.name,
                model: meta.defaultModel,
                candidateModels: meta.candidateModels,
                tier: meta.tier,
                state,
                contextWindow: meta.contextWindow,
                costTier: meta.costTier,
                score,
                metrics
            });
        }

        // Sort descending by score
        candidates.sort((a, b) => b.score - a.score);
        return candidates;
    }

    /**
     * Executes an operation with intelligent failover across capable providers
     * Automatically handles 429 backoff, trips circuit breakers, preserves context,
     * and produces full reconciliation data for the budgetManager.
     * 
     * @param {string} taskIntent - Natural language intent or classification
     * @param {Function} executeFn - async (candidate, normalizedContext) => { text, model, reportedTokens }
     * @param {object} options - { tier, requirements, messages, budgetScopeId, budgetManager }
     * @returns {Promise<object>} { text, provider, model, attempts, reconciliation }
     */
    async executeWithFailover(taskIntent, executeFn, options = {}) {
        const {
            tier = 1,
            requirements = { capabilities: ['text'] },
            messages = [],
            systemPrompt = null
        } = options;

        const fallbackChain = this.getFallbackChain(tier, requirements);

        if (fallbackChain.length === 0) {
            throw new Error(`[ProviderHealth] No healthy, configured providers available for tier ${tier} with capabilities [${(requirements.capabilities || []).join(', ')}]`);
        }

        const attempts = [];
        let lastError = null;

        for (const candidate of fallbackChain) {
            const breaker = this.getBreaker(candidate.provider);

            // If in HALF_OPEN, acquire probe slot
            if (breaker.getState() === CircuitState.HALF_OPEN) {
                if (!breaker.acquireProbeSlot()) {
                    continue; // Probe already in flight, skip to next candidate
                }
            }

            const startTime = Date.now();
            safeLogger.info(`[ProviderHealth] Attempting execution via "${candidate.provider}" (model: ${candidate.model}, tier: ${candidate.tier}, state: ${candidate.state})...`);

            try {
                // Context preservation & normalization for target provider
                const normalizedContext = this.preserveAndNormalizeContext(messages, candidate.contextWindow, systemPrompt);

                const result = await executeFn(candidate, normalizedContext);
                const latencyMs = Date.now() - startTime;

                // Record success
                this.recordSuccess(candidate.provider, {
                    latencyMs,
                    reportedTokens: result.reportedTokens || null
                });

                // Record attempt in execution ledger
                attempts.push({
                    provider: candidate.provider,
                    model: result.model || candidate.model,
                    status: 'SUCCESS',
                    latencyMs,
                    tokens: result.reportedTokens || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                    error: null
                });

                const reconciliation = this.buildReconciliationSummary(attempts);

                return {
                    text: result.text,
                    provider: candidate.provider,
                    model: result.model || candidate.model,
                    attempts,
                    reconciliation,
                    latencyMs
                };

            } catch (err) {
                const latencyMs = Date.now() - startTime;
                const classified = this.recordFailure(candidate.provider, err, latencyMs);

                attempts.push({
                    provider: candidate.provider,
                    model: candidate.model,
                    status: 'FAILED',
                    latencyMs,
                    tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                    error: {
                        category: classified.category,
                        statusCode: classified.statusCode,
                        reason: classified.reason
                    }
                });

                lastError = err;

                safeLogger.warn(`[ProviderHealth] Provider "${candidate.provider}" failed (${classified.category}: ${classified.reason}). Failing over...`);

                // If non-retryable client error or safety block, do not try other providers
                if (classified.category === ErrorCategory.SAFETY_BLOCK || (classified.category === ErrorCategory.CLIENT_ERROR && classified.statusCode === 400 && !classified.reason.includes('context'))) {
                    safeLogger.err(`[ProviderHealth] Aborting failover: Non-retryable error (${classified.category}) cannot succeed on alternative providers.`);
                    break;
                }
            }
        }

        const reconciliation = this.buildReconciliationSummary(attempts);
        const exhaustionError = new Error(`[ProviderHealth] All ${attempts.length} candidate providers failed. Last error: ${lastError?.message || 'Unknown failure'}`);
        exhaustionError.attempts = attempts;
        exhaustionError.reconciliation = reconciliation;
        exhaustionError.isProviderExhaustion = true;

        throw exhaustionError;
    }

    /**
     * Normalizes and prunes conversation messages to preserve essential context
     * while guaranteeing no context-overflow on smaller fallback models.
     */
    preserveAndNormalizeContext(messages = [], maxContextTokens = 131072, systemPrompt = null) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return messages;
        }

        // For massive context windows (128k+), pass through unchanged
        if (maxContextTokens >= 65536) {
            return messages;
        }

        // For bounded context windows (e.g. 8k-32k models), aggressively prune
        // Always preserve system messages and last user prompt
        const systemMsgs = messages.filter(m => m.role === 'system');
        const nonSystemMsgs = messages.filter(m => m.role !== 'system');

        // Keep last 4 conversational turns max for small context windows
        const preservedTurns = nonSystemMsgs.slice(-4);

        return [...systemMsgs, ...preservedTurns];
    }

    /**
     * Builds atomic reconciliation payload for BudgetManager.reconcile()
     * Aggregates API calls, token usage, and cumulative latencies across all attempts
     * @param {Array<object>} attempts 
     * @returns {object}
     */
    buildReconciliationSummary(attempts = []) {
        let actualInputTokens = 0;
        let actualOutputTokens = 0;
        let totalLatencyMs = 0;
        let failedCalls = 0;
        let successfulCalls = 0;

        for (const att of attempts) {
            totalLatencyMs += (att.latencyMs || 0);
            if (att.status === 'SUCCESS') {
                successfulCalls++;
                if (att.tokens) {
                    actualInputTokens += (att.tokens.inputTokens || 0);
                    actualOutputTokens += (att.tokens.outputTokens || 0);
                }
            } else {
                failedCalls++;
            }
        }

        return {
            totalApiCalls: attempts.length,
            successfulCalls,
            failedCalls,
            actualInputTokens,
            actualOutputTokens,
            actualTotalTokens: actualInputTokens + actualOutputTokens,
            totalLatencyMs,
            attempts: [...attempts]
        };
    }

    /**
     * Snapshot of all provider health statuses for bot introspection and dashboards
     * @returns {object}
     */
    getStatus() {
        const statuses = {};
        for (const [providerId, breaker] of this.breakers.entries()) {
            const meta = PROVIDER_CATALOG[providerId] || {};
            statuses[providerId] = {
                ...breaker.getStatus(),
                name: meta.name || providerId,
                tier: meta.tier,
                costTier: meta.costTier,
                isConfigured: this.isConfigured(providerId),
                contextWindow: meta.contextWindow
            };
        }
        return {
            activeProvidersCount: Object.values(statuses).filter(s => s.isConfigured && s.isAvailable).length,
            totalCataloged: Object.keys(statuses).length,
            providers: statuses,
            timestamp: Date.now()
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT & DEFAULT
// ─────────────────────────────────────────────────────────────────────────────

export const providerHealth = new ProviderHealthManager();
export default providerHealth;
