/**
 * src/services/orchestrator/config.js
 * 
 * Centralized Resource Governance & Budget Configuration
 * Defines Dual-Scope Domain separation, 5 Concrete Budget Profiles,
 * Recovery Reserve percentages, and Environment Variable Overrides.
 */

import dotenv from 'dotenv';
import path from 'path';

// Ensure .env is loaded
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Execution Domains (Strict Dual-Scope separation)
 */
export const SCOPE_DOMAINS = Object.freeze({
    DEVELOPMENT: 'development',
    RUNTIME: 'runtime'
});

/**
 * Valid Independent Budget Scopes
 */
export const SCOPE_TYPES = Object.freeze({
    // Development Domain Scopes
    DEVELOPMENT_SESSION: 'development_session',
    DEVELOPMENT_SUBAGENT: 'development_subagent',

    // Runtime Domain Scopes
    RUNTIME_CONVERSATION: 'runtime_conversation',
    RUNTIME_TASK: 'runtime_task',
    RUNTIME_SUBAGENT: 'runtime_subagent',
    SELF_HEALING_TASK: 'self_healing_task'
});

/**
 * Mapping from Scope Type to Scope Domain
 */
export const SCOPE_DOMAIN_MAP = Object.freeze({
    [SCOPE_TYPES.DEVELOPMENT_SESSION]: SCOPE_DOMAINS.DEVELOPMENT,
    [SCOPE_TYPES.DEVELOPMENT_SUBAGENT]: SCOPE_DOMAINS.DEVELOPMENT,
    [SCOPE_TYPES.RUNTIME_CONVERSATION]: SCOPE_DOMAINS.RUNTIME,
    [SCOPE_TYPES.RUNTIME_TASK]: SCOPE_DOMAINS.RUNTIME,
    [SCOPE_TYPES.RUNTIME_SUBAGENT]: SCOPE_DOMAINS.RUNTIME,
    [SCOPE_TYPES.SELF_HEALING_TASK]: SCOPE_DOMAINS.RUNTIME
});

/**
 * Valid Scope Statuses
 */
export const SCOPE_STATUS = Object.freeze({
    ACTIVE: 'ACTIVE',
    COMPLETED: 'COMPLETED',
    EXHAUSTED: 'EXHAUSTED',
    CANCELLED: 'CANCELLED'
});

/**
 * Valid Reservation Statuses
 */
export const RESERVATION_STATUS = Object.freeze({
    PENDING: 'PENDING',
    RECONCILED: 'RECONCILED',
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED'
});

/**
 * Valid Reserve Release Reasons
 */
export const RESERVE_RELEASE_REASONS = Object.freeze({
    RECOVERY: 'RECOVERY',
    ROLLBACK: 'ROLLBACK',
    CRITICAL_SELF_HEALING: 'CRITICAL_SELF_HEALING'
});

/**
 * Model Tiers & Pricing Coefficients (USD per 1M tokens) for Telemetry
 */
export const MODEL_TIER_RATES = Object.freeze({
    TIER_0: { inputPer1M: 0, outputPer1M: 0 },          // Deterministic / Local
    TIER_1: { inputPer1M: 0.08, outputPer1M: 0.08 },     // Fast / Lightweight (e.g. Groq 8B, Gemini Flash)
    TIER_2: { inputPer1M: 0.70, outputPer1M: 0.80 },     // General Reasoning (e.g. Hermes-3 70B, Nemotron 70B)
    TIER_3: { inputPer1M: 2.50, outputPer1M: 2.50 }      // Specialist Engineering (e.g. DeepSeek V4 Pro, Nemotron Super)
});

/**
 * Default 5 Budget Profiles
 */
const DEFAULT_PROFILES = {
    micro: {
        maxInputTokens: 2000,
        maxOutputTokens: 500,
        maxApiCalls: 2,
        maxToolCalls: 1,
        maxAgentLoopIterations: 2,
        maxRetries: 1,
        maxConcurrentRequests: 1,
        maxExecutionDurationMs: 10000,     // 10 seconds
        maxSubAgentBudget: 0,              // Sub-agents forbidden in micro
        recoveryReservePercent: 0.15
    },
    standard: {
        maxInputTokens: 8000,
        maxOutputTokens: 2000,
        maxApiCalls: 5,
        maxToolCalls: 5,
        maxAgentLoopIterations: 5,
        maxRetries: 2,
        maxConcurrentRequests: 1,
        maxExecutionDurationMs: 30000,     // 30 seconds
        maxSubAgentBudget: 2000,
        recoveryReservePercent: 0.15
    },
    complex: {
        maxInputTokens: 32000,
        maxOutputTokens: 8000,
        maxApiCalls: 15,
        maxToolCalls: 15,
        maxAgentLoopIterations: 10,
        maxRetries: 3,
        maxConcurrentRequests: 2,
        maxExecutionDurationMs: 120000,    // 2 minutes
        maxSubAgentBudget: 8000,
        recoveryReservePercent: 0.15
    },
    engineering: {
        maxInputTokens: 64000,
        maxOutputTokens: 16000,
        maxApiCalls: 25,
        maxToolCalls: 25,
        maxAgentLoopIterations: 15,
        maxRetries: 4,
        maxConcurrentRequests: 2,
        maxExecutionDurationMs: 300000,    // 5 minutes
        maxSubAgentBudget: 16000,
        recoveryReservePercent: 0.15
    },
    'critical-recovery': {
        maxInputTokens: 48000,
        maxOutputTokens: 12000,
        maxApiCalls: 20,
        maxToolCalls: 20,
        maxAgentLoopIterations: 12,
        maxRetries: 5,
        maxConcurrentRequests: 2,
        maxExecutionDurationMs: 180000,    // 3 minutes
        maxSubAgentBudget: 12000,
        recoveryReservePercent: 0.15
    }
};

/**
 * Resolve profile configuration merged with environment variable overrides
 */
function buildResolvedProfiles() {
    const profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));

    // Global reserve override if present
    const envGlobalReserve = process.env.WABOT_BUDGET_RECOVERY_RESERVE_PERCENT;
    const globalReserve = envGlobalReserve ? parseFloat(envGlobalReserve) : null;

    for (const [profileName, defaults] of Object.entries(profiles)) {
        const prefix = `WABOT_BUDGET_${profileName.toUpperCase().replace('-', '_')}_`;

        if (globalReserve !== null && !isNaN(globalReserve)) {
            defaults.recoveryReservePercent = globalReserve;
        }

        const envInput = process.env[`${prefix}MAX_INPUT_TOKENS`];
        if (envInput) defaults.maxInputTokens = parseInt(envInput, 10);

        const envOutput = process.env[`${prefix}MAX_OUTPUT_TOKENS`];
        if (envOutput) defaults.maxOutputTokens = parseInt(envOutput, 10);

        const envApi = process.env[`${prefix}MAX_API_CALLS`];
        if (envApi) defaults.maxApiCalls = parseInt(envApi, 10);

        const envTools = process.env[`${prefix}MAX_TOOL_CALLS`];
        if (envTools) defaults.maxToolCalls = parseInt(envTools, 10);

        const envIter = process.env[`${prefix}MAX_ITERATIONS`];
        if (envIter) defaults.maxAgentLoopIterations = parseInt(envIter, 10);

        const envRetries = process.env[`${prefix}MAX_RETRIES`];
        if (envRetries) defaults.maxRetries = parseInt(envRetries, 10);

        const envDuration = process.env[`${prefix}MAX_DURATION_MS`];
        if (envDuration) defaults.maxExecutionDurationMs = parseInt(envDuration, 10);

        const envSubBudget = process.env[`${prefix}MAX_SUB_AGENT_BUDGET`];
        if (envSubBudget) defaults.maxSubAgentBudget = parseInt(envSubBudget, 10);
    }

    return Object.freeze(profiles);
}

export const BUDGET_PROFILES = buildResolvedProfiles();

/**
 * General Orchestrator Budget Settings
 */
export const BUDGET_SETTINGS = Object.freeze({
    defaultReservationTtlMs: parseInt(process.env.WABOT_BUDGET_RESERVATION_TTL_MS || '60000', 10), // 60s
    maxSubAgentsPerTask: 3,
    maxConcurrentSubAgents: 2,
    maxDelegationDepth: 1,
    defaultProfile: 'standard',
    heuristicCharsPerToken: 3.8, // safe multiplier for multilingual / Indonesian
    tokenizerSafetyFactor: 1.15
});

export default {
    SCOPE_DOMAINS,
    SCOPE_TYPES,
    SCOPE_DOMAIN_MAP,
    SCOPE_STATUS,
    RESERVATION_STATUS,
    RESERVE_RELEASE_REASONS,
    MODEL_TIER_RATES,
    BUDGET_PROFILES,
    BUDGET_SETTINGS
};
