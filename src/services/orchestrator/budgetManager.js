/**
 * src/services/orchestrator/budgetManager.js
 * 
 * Resource-Aware Agent Budget Manager & Dual-Scope Resource Governance
 * Implements Phase 2A & 2B:
 * - Dual-Scope separation (development_* vs runtime_*)
 * - 6 Independent Budget Scopes
 * - 5 Concrete Budget Profiles with 15% Recovery Reserve
 * - Atomic 7-Step Request Lifecycle (Estimate -> Check -> Select -> Reserve -> Execute -> Reconcile -> Update)
 * - Zero Silent Overruns (Strict hard errors on limits)
 * - Complete telemetry, state tracking, and depth-1 sub-agent delegation.
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import {
    SCOPE_DOMAINS,
    SCOPE_TYPES,
    SCOPE_DOMAIN_MAP,
    SCOPE_STATUS,
    RESERVATION_STATUS,
    RESERVE_RELEASE_REASONS,
    MODEL_TIER_RATES,
    BUDGET_PROFILES,
    BUDGET_SETTINGS
} from './config.js';

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM ERROR HIERARCHY (ZERO SILENT OVERRUNS)
// ─────────────────────────────────────────────────────────────────────────────

export class BudgetError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class BudgetExceededError extends BudgetError {
    constructor(scopeId, dimension, requested, available, limit) {
        super(`Budget exceeded for scope [${scopeId}] on dimension [${dimension}]. Requested: ${requested}, Available: ${available}, Total Limit: ${limit}`, {
            scopeId,
            dimension,
            requested,
            available,
            limit
        });
    }
}

export class ScopeExhaustedError extends BudgetError {
    constructor(scopeId, reason = 'Budget exhausted') {
        super(`Scope [${scopeId}] is in EXHAUSTED state. ${reason}`, { scopeId, reason });
    }
}

export class ReserveLockedError extends BudgetError {
    constructor(scopeId, requested, operationalRemaining, reserveSize) {
        super(`Scope [${scopeId}] cannot fulfill request of ${requested} tokens without penetrating locked 15% recovery reserve (${reserveSize} tokens). Operational remaining: ${operationalRemaining}. Call releaseReserve() if authorized for recovery/rollback.`, {
            scopeId,
            requested,
            operationalRemaining,
            reserveSize
        });
    }
}

export class BudgetDomainViolationError extends BudgetError {
    constructor(message, details = {}) {
        super(`Budget Domain Violation: ${message}`, details);
    }
}

export class SubAgentDelegationError extends BudgetError {
    constructor(message, details = {}) {
        super(`Sub-agent delegation error: ${message}`, details);
    }
}

export class ReservationNotFoundError extends BudgetError {
    constructor(reservationId, scopeId) {
        super(`Reservation [${reservationId}] not found or already reconciled in scope [${scopeId}]`, { reservationId, scopeId });
    }
}

export class ConcurrencyLimitExceededError extends BudgetError {
    constructor(scopeId, current, max) {
        super(`Concurrency limit exceeded for scope [${scopeId}]. Active requests: ${current}, Max concurrent: ${max}`, {
            scopeId,
            current,
            max
        });
    }
}

export class ExecutionTimeoutError extends BudgetError {
    constructor(scopeId, elapsedMs, maxMs) {
        super(`Execution timeout exceeded for scope [${scopeId}]. Elapsed: ${elapsedMs}ms, Max: ${maxMs}ms`, {
            scopeId,
            elapsedMs,
            maxMs
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPE INSTANCE DATA MODEL
// ─────────────────────────────────────────────────────────────────────────────

class ScopeInstance {
    constructor({ id, type, profileName, domain, customLimits = {}, parentScope = null }) {
        this.id = id;
        this.type = type;
        this.domain = domain;
        this.profile = profileName;
        this.parentScopeId = parentScope ? parentScope.id : null;
        this.depth = parentScope ? parentScope.depth + 1 : 0;
        this.childScopeIds = [];
        this.status = SCOPE_STATUS.ACTIVE;

        this.createdAt = Date.now();
        this.completedAt = null;
        this.durationMs = 0;

        // Base profile limits merged with customLimits
        const base = BUDGET_PROFILES[profileName] || BUDGET_PROFILES.standard;
        this.limits = {
            maxInputTokens: customLimits.maxInputTokens ?? base.maxInputTokens,
            maxOutputTokens: customLimits.maxOutputTokens ?? base.maxOutputTokens,
            maxApiCalls: customLimits.maxApiCalls ?? base.maxApiCalls,
            maxToolCalls: customLimits.maxToolCalls ?? base.maxToolCalls,
            maxAgentLoopIterations: customLimits.maxAgentLoopIterations ?? base.maxAgentLoopIterations,
            maxRetries: customLimits.maxRetries ?? base.maxRetries,
            maxConcurrentRequests: customLimits.maxConcurrentRequests ?? base.maxConcurrentRequests,
            maxExecutionDurationMs: customLimits.maxExecutionDurationMs ?? base.maxExecutionDurationMs,
            maxSubAgentBudget: customLimits.maxSubAgentBudget ?? base.maxSubAgentBudget,
            recoveryReservePercent: customLimits.recoveryReservePercent ?? base.recoveryReservePercent
        };

        // 15% Recovery Reserve partition
        const reservePercent = this.limits.recoveryReservePercent;
        this.reserve = {
            percent: reservePercent,
            isLocked: true,
            inputTokens: Math.floor(this.limits.maxInputTokens * reservePercent),
            outputTokens: Math.floor(this.limits.maxOutputTokens * reservePercent),
            apiCalls: Math.max(1, Math.floor(this.limits.maxApiCalls * reservePercent)),
            releasedAt: null,
            releaseReason: null,
            releasedBy: null
        };

        // Operational limits (Total minus 15% Reserve initially)
        this.operationalLimit = {
            inputTokens: this.limits.maxInputTokens - this.reserve.inputTokens,
            outputTokens: this.limits.maxOutputTokens - this.reserve.outputTokens,
            apiCalls: this.limits.maxApiCalls - this.reserve.apiCalls
        };

        // Consumption ledger (Lifetime actual usage)
        this.consumed = {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            apiCalls: 0,
            toolCalls: 0,
            agentLoopIterations: 0,
            retries: 0,
            totalLatencyMs: 0,
            estimatedCostUsd: 0
        };

        // In-flight active reservations
        this.reserved = {
            inputTokens: 0,
            outputTokens: 0,
            apiCalls: 0,
            activeCount: 0
        };

        // Active reservations map: reservationId -> Reservation
        this.activeReservations = new Map();

        // Sub-agent delegated tokens tracking (deducted from remaining, refunded on finish)
        this.delegatedToChildren = {
            inputTokens: 0,
            outputTokens: 0,
            apiCalls: 0
        };

        // Telemetry counters
        this.telemetry = {
            reservationsCreated: 0,
            reservationsReconciled: 0,
            reservationsCancelled: 0,
            reservationsExpired: 0,
            providerCalls: {} // provider -> { calls, inputTokens, outputTokens, latencyMs }
        };
    }

    /**
     * Compute remaining operational budget
     */
    getRemaining() {
        const availableBaseInput = this.reserve.isLocked 
            ? this.operationalLimit.inputTokens 
            : this.limits.maxInputTokens;

        const availableBaseOutput = this.reserve.isLocked 
            ? this.operationalLimit.outputTokens 
            : this.limits.maxOutputTokens;

        const availableBaseApiCalls = this.reserve.isLocked 
            ? this.operationalLimit.apiCalls 
            : this.limits.maxApiCalls;

        const remainingInputTokens = Math.max(0, availableBaseInput - this.consumed.inputTokens - this.reserved.inputTokens - this.delegatedToChildren.inputTokens);
        const remainingOutputTokens = Math.max(0, availableBaseOutput - this.consumed.outputTokens - this.reserved.outputTokens - this.delegatedToChildren.outputTokens);
        const remainingApiCalls = Math.max(0, availableBaseApiCalls - this.consumed.apiCalls - this.reserved.apiCalls - this.delegatedToChildren.apiCalls);
        const remainingToolCalls = Math.max(0, this.limits.maxToolCalls - this.consumed.toolCalls);
        const remainingIterations = Math.max(0, this.limits.maxAgentLoopIterations - this.consumed.agentLoopIterations);
        const remainingRetries = Math.max(0, this.limits.maxRetries - this.consumed.retries);

        const elapsedMs = Date.now() - this.createdAt;
        const remainingDurationMs = Math.max(0, this.limits.maxExecutionDurationMs - elapsedMs);

        return {
            inputTokens: remainingInputTokens,
            outputTokens: remainingOutputTokens,
            apiCalls: remainingApiCalls,
            toolCalls: remainingToolCalls,
            agentLoopIterations: remainingIterations,
            retries: remainingRetries,
            durationMs: remainingDurationMs,
            isReserveLocked: this.reserve.isLocked,
            reserveBuffer: {
                inputTokens: this.reserve.inputTokens,
                outputTokens: this.reserve.outputTokens,
                apiCalls: this.reserve.apiCalls
            }
        };
    }

    /**
     * Verify scope health and active timeouts
     */
    assertOperational() {
        if (this.status === SCOPE_STATUS.EXHAUSTED) {
            throw new ScopeExhaustedError(this.id, 'Budget has been exhausted');
        }
        if (this.status === SCOPE_STATUS.COMPLETED || this.status === SCOPE_STATUS.CANCELLED) {
            throw new ScopeExhaustedError(this.id, `Scope is ${this.status}`);
        }

        const elapsedMs = Date.now() - this.createdAt;
        if (elapsedMs > this.limits.maxExecutionDurationMs) {
            this.status = SCOPE_STATUS.EXHAUSTED;
            throw new ExecutionTimeoutError(this.id, elapsedMs, this.limits.maxExecutionDurationMs);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CENTRAL BUDGET MANAGER
// ─────────────────────────────────────────────────────────────────────────────

export class BudgetManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.scopes = new Map();
        this.settings = { ...BUDGET_SETTINGS, ...options };

        // Global interval to automatically clean expired reservations
        this.cleanupInterval = setInterval(() => {
            this.cleanExpiredReservations();
        }, 15000);
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }

    /**
     * Terminate cleanup interval on shutdown
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.scopes.clear();
        this.removeAllListeners();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SCOPE LIFECYCLE MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Create a new independent budget scope
     * @param {string} scopeType - One of SCOPE_TYPES
     * @param {object} options - { profile, customLimits, scopeId }
     * @returns {object} Scope instance summary
     */
    createScope(scopeType, options = {}) {
        if (!Object.values(SCOPE_TYPES).includes(scopeType)) {
            throw new BudgetError(`Invalid scopeType: "${scopeType}". Must be one of: ${Object.values(SCOPE_TYPES).join(', ')}`);
        }

        const domain = SCOPE_DOMAIN_MAP[scopeType];
        if (!domain) {
            throw new BudgetDomainViolationError(`Unknown domain for scopeType "${scopeType}"`);
        }

        const profileName = options.profile || this.settings.defaultProfile;
        if (!BUDGET_PROFILES[profileName]) {
            throw new BudgetError(`Unknown profile: "${profileName}". Must be one of: ${Object.keys(BUDGET_PROFILES).join(', ')}`);
        }

        const scopeId = options.scopeId || `scope_${domain.slice(0, 3)}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        if (this.scopes.has(scopeId)) {
            throw new BudgetError(`Scope ID "${scopeId}" already exists`);
        }

        const scope = new ScopeInstance({
            id: scopeId,
            type: scopeType,
            profileName,
            domain,
            customLimits: options.customLimits || {},
            parentScope: null
        });

        this.scopes.set(scopeId, scope);

        this.emit('scope:created', {
            scopeId: scope.id,
            scopeType: scope.type,
            domain: scope.domain,
            profile: scope.profile,
            limits: scope.limits,
            reserve: scope.reserve
        });

        return this.getScopeSummary(scopeId);
    }

    /**
     * Create a child sub-agent scope with depth-1 enforcement
     * @param {string} parentScopeId
     * @param {object} options - { scopeType, budgetAllocation: { inputTokens, outputTokens, apiCalls }, profile }
     * @returns {object} Child scope summary
     */
    createChildScope(parentScopeId, options = {}) {
        const parent = this.getScopeInstance(parentScopeId);
        parent.assertOperational();

        // 1. Enforce max delegation depth 1
        if (parent.depth >= this.settings.maxDelegationDepth) {
            throw new SubAgentDelegationError(
                `Max delegation depth of ${this.settings.maxDelegationDepth} exceeded. Parent scope [${parentScopeId}] is at depth ${parent.depth}. Recursive sub-agent spawning is strictly prohibited.`,
                { parentScopeId, parentDepth: parent.depth }
            );
        }

        // 2. Enforce cumulative sub-agent count limit (max 3)
        if (parent.childScopeIds.length >= this.settings.maxSubAgentsPerTask) {
            throw new SubAgentDelegationError(
                `Max sub-agents limit (${this.settings.maxSubAgentsPerTask}) reached for parent scope [${parentScopeId}]. Cumulative children: ${parent.childScopeIds.length}`,
                { parentScopeId, childCount: parent.childScopeIds.length }
            );
        }

        // 3. Enforce active concurrent sub-agents limit (max 2)
        const activeChildren = parent.childScopeIds
            .map(id => this.scopes.get(id))
            .filter(child => child && child.status === SCOPE_STATUS.ACTIVE);

        if (activeChildren.length >= this.settings.maxConcurrentSubAgents) {
            throw new ConcurrencyLimitExceededError(
                parentScopeId,
                activeChildren.length,
                this.settings.maxConcurrentSubAgents
            );
        }

        // 4. Validate domain consistency (Strict Dual-Scope Separation)
        const requestedType = options.scopeType || (
            parent.domain === SCOPE_DOMAINS.DEVELOPMENT 
                ? SCOPE_TYPES.DEVELOPMENT_SUBAGENT 
                : SCOPE_TYPES.RUNTIME_SUBAGENT
        );

        const childDomain = SCOPE_DOMAIN_MAP[requestedType];
        if (childDomain !== parent.domain) {
            throw new BudgetDomainViolationError(
                `Cannot delegate child scope of domain "${childDomain}" from parent of domain "${parent.domain}". Scopes must never cross domain boundaries!`,
                { parentDomain: parent.domain, childDomain, requestedType }
            );
        }

        // 5. Calculate and validate child budget allocation
        const parentRemaining = parent.getRemaining();
        const allocation = options.budgetAllocation || {};
        const maxChildBudgetAllowed = Math.min(parentRemaining.inputTokens, parent.limits.maxSubAgentBudget || parentRemaining.inputTokens);

        const childInputTokens = allocation.inputTokens ?? Math.min(2000, maxChildBudgetAllowed);
        const childOutputTokens = allocation.outputTokens ?? Math.min(500, parentRemaining.outputTokens);
        const childApiCalls = allocation.apiCalls ?? Math.min(2, parentRemaining.apiCalls);

        if (childInputTokens > parentRemaining.inputTokens) {
            throw new BudgetExceededError(parentScopeId, 'childInputTokens', childInputTokens, parentRemaining.inputTokens, parent.limits.maxInputTokens);
        }
        if (childOutputTokens > parentRemaining.outputTokens) {
            throw new BudgetExceededError(parentScopeId, 'childOutputTokens', childOutputTokens, parentRemaining.outputTokens, parent.limits.maxOutputTokens);
        }
        if (childApiCalls > parentRemaining.apiCalls) {
            throw new BudgetExceededError(parentScopeId, 'childApiCalls', childApiCalls, parentRemaining.apiCalls, parent.limits.maxApiCalls);
        }

        // 6. Hold child budget from parent
        parent.delegatedToChildren.inputTokens += childInputTokens;
        parent.delegatedToChildren.outputTokens += childOutputTokens;
        parent.delegatedToChildren.apiCalls += childApiCalls;

        const childScopeId = `sub_${parent.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const childProfile = options.profile || 'micro';

        const childScope = new ScopeInstance({
            id: childScopeId,
            type: requestedType,
            profileName: childProfile,
            domain: parent.domain,
            customLimits: {
                maxInputTokens: childInputTokens,
                maxOutputTokens: childOutputTokens,
                maxApiCalls: childApiCalls,
                maxToolCalls: options.maxToolCalls ?? 3,
                maxAgentLoopIterations: options.maxAgentLoopIterations ?? 3,
                maxRetries: 1,
                maxConcurrentRequests: 1,
                maxExecutionDurationMs: options.maxExecutionDurationMs ?? Math.min(60000, parentRemaining.durationMs),
                maxSubAgentBudget: 0, // Depth 1 cannot delegate further
                recoveryReservePercent: 0.15
            },
            parentScope: parent
        });

        this.scopes.set(childScopeId, childScope);
        parent.childScopeIds.push(childScopeId);

        this.emit('scope:child_created', {
            parentScopeId: parent.id,
            childScopeId: childScope.id,
            allocated: {
                inputTokens: childInputTokens,
                outputTokens: childOutputTokens,
                apiCalls: childApiCalls
            }
        });

        return this.getScopeSummary(childScopeId);
    }

    /**
     * Complete a scope, reclaiming unused sub-agent budgets back to parent
     */
    completeScope(scopeId, metadata = {}) {
        const scope = this.getScopeInstance(scopeId);
        if (scope.status === SCOPE_STATUS.COMPLETED) {
            return this.getScopeSummary(scopeId);
        }

        // Auto-reconcile or cancel any lingering pending reservations
        for (const [resId, res] of scope.activeReservations.entries()) {
            if (res.status === RESERVATION_STATUS.PENDING) {
                this.cancelReservation(scopeId, resId, 'Scope completed with active reservation');
            }
        }

        scope.status = SCOPE_STATUS.COMPLETED;
        scope.completedAt = Date.now();
        scope.durationMs = scope.completedAt - scope.createdAt;

        // If this is a child sub-agent, refund unspent budget back to parent
        if (scope.parentScopeId) {
            const parent = this.scopes.get(scope.parentScopeId);
            if (parent && parent.status === SCOPE_STATUS.ACTIVE) {
                const unspentInput = Math.max(0, scope.limits.maxInputTokens - scope.consumed.inputTokens);
                const unspentOutput = Math.max(0, scope.limits.maxOutputTokens - scope.consumed.outputTokens);
                const unspentApiCalls = Math.max(0, scope.limits.maxApiCalls - scope.consumed.apiCalls);

                // Reclaim
                parent.delegatedToChildren.inputTokens = Math.max(0, parent.delegatedToChildren.inputTokens - unspentInput);
                parent.delegatedToChildren.outputTokens = Math.max(0, parent.delegatedToChildren.outputTokens - unspentOutput);
                parent.delegatedToChildren.apiCalls = Math.max(0, parent.delegatedToChildren.apiCalls - unspentApiCalls);

                // Add child actual consumed to parent consumed for rollup reporting without double counting
                parent.consumed.cachedInputTokens += scope.consumed.cachedInputTokens;
                parent.consumed.totalLatencyMs += scope.consumed.totalLatencyMs;
                parent.consumed.estimatedCostUsd += scope.consumed.estimatedCostUsd;

                this.emit('subagent:refunded', {
                    parentScopeId: parent.id,
                    childScopeId: scope.id,
                    refunded: {
                        inputTokens: unspentInput,
                        outputTokens: unspentOutput,
                        apiCalls: unspentApiCalls
                    }
                });
            }
        }

        this.emit('scope:completed', {
            scopeId: scope.id,
            durationMs: scope.durationMs,
            consumed: scope.consumed,
            metadata
        });

        return this.getScopeSummary(scopeId);
    }

    /**
     * Cancel a scope prematurely
     */
    cancelScope(scopeId, reason = 'Cancelled by caller') {
        const scope = this.getScopeInstance(scopeId);
        if (scope.status === SCOPE_STATUS.COMPLETED || scope.status === SCOPE_STATUS.CANCELLED) {
            return this.getScopeSummary(scopeId);
        }

        // Cancel all pending reservations
        for (const [resId, res] of scope.activeReservations.entries()) {
            if (res.status === RESERVATION_STATUS.PENDING) {
                this.cancelReservation(scopeId, resId, `Scope cancelled: ${reason}`);
            }
        }

        scope.status = SCOPE_STATUS.CANCELLED;
        scope.completedAt = Date.now();
        scope.durationMs = scope.completedAt - scope.createdAt;

        // Refund parent if child
        if (scope.parentScopeId) {
            const parent = this.scopes.get(scope.parentScopeId);
            if (parent) {
                const unspentInput = Math.max(0, scope.limits.maxInputTokens - scope.consumed.inputTokens);
                const unspentOutput = Math.max(0, scope.limits.maxOutputTokens - scope.consumed.outputTokens);
                const unspentApiCalls = Math.max(0, scope.limits.maxApiCalls - scope.consumed.apiCalls);

                parent.delegatedToChildren.inputTokens = Math.max(0, parent.delegatedToChildren.inputTokens - unspentInput);
                parent.delegatedToChildren.outputTokens = Math.max(0, parent.delegatedToChildren.outputTokens - unspentOutput);
                parent.delegatedToChildren.apiCalls = Math.max(0, parent.delegatedToChildren.apiCalls - unspentApiCalls);
            }
        }

        this.emit('scope:cancelled', { scopeId: scope.id, reason });
        return this.getScopeSummary(scopeId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. 15% RECOVERY RESERVE MECHANICS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Explicitly unlock the 15% Recovery Reserve buffer.
     * Can ONLY be called for critical recovery, rollback, or self-healing.
     * @param {string} scopeId
     * @param {object|string} releaseParams - { reason, caller, component } or string reason
     * @returns {object} Updated remaining state
     */
    releaseReserve(scopeId, releaseParams = {}) {
        const scope = this.getScopeInstance(scopeId);
        const params = (releaseParams && typeof releaseParams === 'object') ? releaseParams : {};
        const reason = typeof releaseParams === 'string' ? releaseParams : params.reason;

        if (!reason || !Object.values(RESERVE_RELEASE_REASONS).includes(reason)) {
            throw new BudgetError(
                `Unauthorized attempt to release recovery reserve for scope [${scopeId}]. Reason "${reason}" is invalid. Must be one of: ${Object.values(RESERVE_RELEASE_REASONS).join(', ')}`,
                { scopeId, reason }
            );
        }

        if (!scope.reserve.isLocked) {
            return scope.getRemaining(); // Already released
        }

        scope.reserve.isLocked = false;
        scope.reserve.releasedAt = Date.now();
        scope.reserve.releaseReason = reason;
        scope.reserve.releasedBy = (params.caller && typeof params.caller === 'string' && params.caller.trim())
            ? params.caller.trim()
            : 'orchestrator_recovery';

        this.emit('reserve:released', {
            scopeId: scope.id,
            reason,
            caller: scope.reserve.releasedBy,
            unlocked: {
                inputTokens: scope.reserve.inputTokens,
                outputTokens: scope.reserve.outputTokens,
                apiCalls: scope.reserve.apiCalls
            }
        });

        return scope.getRemaining();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. ATOMIC 7-STEP PRE-REQUEST RESERVATION & POST-RECONCILIATION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Step 1 Helper: Heuristic input token estimator
     */
    estimateTokens(text = '', safetyMultiplier = BUDGET_SETTINGS.tokenizerSafetyFactor) {
        if (!text || typeof text !== 'string') return 0;
        const charLength = text.length;
        const baseEstimate = Math.ceil(charLength / this.settings.heuristicCharsPerToken);
        return Math.ceil(baseEstimate * safetyMultiplier);
    }

    /**
     * Step 2 & 4: Check allocation and Atomically Reserve resources before LLM call
     * @param {string} scopeId
     * @param {object} params - { estimatedInputTokens, estimatedOutputTokens, modelTier, provider, model }
     * @returns {string} reservationId
     */
    reserve(scopeId, params = {}) {
        const scope = this.getScopeInstance(scopeId);
        scope.assertOperational();

        // Concurrency check
        if (scope.reserved.activeCount >= scope.limits.maxConcurrentRequests) {
            throw new ConcurrencyLimitExceededError(
                scopeId,
                scope.reserved.activeCount,
                scope.limits.maxConcurrentRequests
            );
        }

        const estInput = Math.max(1, params.estimatedInputTokens || 100);
        const estOutput = Math.max(1, params.estimatedOutputTokens || 200);
        const remaining = scope.getRemaining();

        // Operational remaining checks
        if (remaining.apiCalls < 1) {
            throw new BudgetExceededError(scopeId, 'apiCalls', 1, remaining.apiCalls, scope.limits.maxApiCalls);
        }

        if (estInput > remaining.inputTokens) {
            // Check if reserve is locked and could fit if unlocked
            if (scope.reserve.isLocked && (remaining.inputTokens + scope.reserve.inputTokens >= estInput)) {
                throw new ReserveLockedError(scopeId, estInput, remaining.inputTokens, scope.reserve.inputTokens);
            }
            throw new BudgetExceededError(scopeId, 'inputTokens', estInput, remaining.inputTokens, scope.limits.maxInputTokens);
        }

        if (estOutput > remaining.outputTokens) {
            if (scope.reserve.isLocked && (remaining.outputTokens + scope.reserve.outputTokens >= estOutput)) {
                throw new ReserveLockedError(scopeId, estOutput, remaining.outputTokens, scope.reserve.outputTokens);
            }
            throw new BudgetExceededError(scopeId, 'outputTokens', estOutput, remaining.outputTokens, scope.limits.maxOutputTokens);
        }

        // Generate reservationId
        const reservationId = `res_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const reservation = {
            id: reservationId,
            scopeId: scope.id,
            estimatedInputTokens: estInput,
            estimatedOutputTokens: estOutput,
            modelTier: params.modelTier ?? 'TIER_1',
            provider: params.provider ?? 'unknown',
            model: params.model ?? 'unknown',
            createdAt: Date.now(),
            expiresAt: Date.now() + (params.ttlMs || this.settings.defaultReservationTtlMs),
            status: RESERVATION_STATUS.PENDING
        };

        // Atomically place hold
        scope.reserved.inputTokens += estInput;
        scope.reserved.outputTokens += estOutput;
        scope.reserved.apiCalls += 1;
        scope.reserved.activeCount += 1;

        scope.activeReservations.set(reservationId, reservation);
        scope.telemetry.reservationsCreated += 1;

        this.emit('budget:reserved', {
            scopeId: scope.id,
            reservationId,
            estimatedInputTokens: estInput,
            estimatedOutputTokens: estOutput,
            activeReservations: scope.reserved.activeCount
        });

        return reservationId;
    }

    /**
     * Step 6 & 7: Post-request usage reconciliation & budget update
     * @param {string} scopeId
     * @param {string} reservationId
     * @param {object} actualUsage - { actualInputTokens, actualOutputTokens, cachedInputTokens, latencyMs, provider, model }
     * @returns {object} Reconciliation summary
     */
    reconcile(scopeId, reservationId, actualUsage = {}) {
        const scope = this.getScopeInstance(scopeId);
        const reservation = scope.activeReservations.get(reservationId);

        if (!reservation) {
            throw new ReservationNotFoundError(reservationId, scopeId);
        }

        if (reservation.status !== RESERVATION_STATUS.PENDING) {
            throw new BudgetError(`Reservation [${reservationId}] is already ${reservation.status}`);
        }

        // 1. Release reserved hold
        scope.reserved.inputTokens = Math.max(0, scope.reserved.inputTokens - reservation.estimatedInputTokens);
        scope.reserved.outputTokens = Math.max(0, scope.reserved.outputTokens - reservation.estimatedOutputTokens);
        scope.reserved.apiCalls = Math.max(0, scope.reserved.apiCalls - 1);
        scope.reserved.activeCount = Math.max(0, scope.reserved.activeCount - 1);

        // 2. Determine actual values
        const actualInput = actualUsage.actualInputTokens ?? reservation.estimatedInputTokens;
        const actualOutput = actualUsage.actualOutputTokens ?? reservation.estimatedOutputTokens;
        const cachedInput = actualUsage.cachedInputTokens ?? 0;
        const latencyMs = actualUsage.latencyMs ?? (Date.now() - reservation.createdAt);
        const provider = actualUsage.provider || reservation.provider;
        const model = actualUsage.model || reservation.model;

        // 3. Update lifetime consumed metrics
        scope.consumed.inputTokens += actualInput;
        scope.consumed.outputTokens += actualOutput;
        scope.consumed.cachedInputTokens += cachedInput;
        scope.consumed.apiCalls += 1;
        scope.consumed.totalLatencyMs += latencyMs;

        // Calculate estimated cost
        const tierKey = reservation.modelTier || 'TIER_1';
        const rates = MODEL_TIER_RATES[tierKey] || MODEL_TIER_RATES.TIER_1;
        const costUsd = ((actualInput / 1_000_000) * rates.inputPer1M) + ((actualOutput / 1_000_000) * rates.outputPer1M);
        scope.consumed.estimatedCostUsd += costUsd;

        // Provider telemetry
        if (!scope.telemetry.providerCalls[provider]) {
            scope.telemetry.providerCalls[provider] = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
        }
        scope.telemetry.providerCalls[provider].calls += 1;
        scope.telemetry.providerCalls[provider].inputTokens += actualInput;
        scope.telemetry.providerCalls[provider].outputTokens += actualOutput;
        scope.telemetry.providerCalls[provider].latencyMs += latencyMs;

        // 4. Mark reservation as reconciled and remove from active map
        reservation.status = RESERVATION_STATUS.RECONCILED;
        reservation.reconciledAt = Date.now();
        reservation.actualInputTokens = actualInput;
        reservation.actualOutputTokens = actualOutput;
        scope.activeReservations.delete(reservationId);
        scope.telemetry.reservationsReconciled += 1;

        // 5. Evaluate remaining budget against total limits
        const remaining = scope.getRemaining();

        // Check if scope has exhausted its budget
        const isDepleted = remaining.inputTokens <= 0 || remaining.outputTokens <= 0 || remaining.apiCalls <= 0;
        if (isDepleted && scope.reserve.isLocked) {
            scope.status = SCOPE_STATUS.EXHAUSTED;
            this.emit('scope:exhausted', {
                scopeId: scope.id,
                consumed: scope.consumed,
                reason: 'Operational allocation depleted while reserve is locked'
            });
        }

        const reconciliationResult = {
            scopeId: scope.id,
            reservationId,
            estimated: {
                inputTokens: reservation.estimatedInputTokens,
                outputTokens: reservation.estimatedOutputTokens
            },
            actual: {
                inputTokens: actualInput,
                outputTokens: actualOutput,
                cachedInputTokens: cachedInput
            },
            deltaInput: actualInput - reservation.estimatedInputTokens,
            deltaOutput: actualOutput - reservation.estimatedOutputTokens,
            costUsd,
            remaining
        };

        this.emit('budget:reconciled', reconciliationResult);

        return reconciliationResult;
    }

    /**
     * Cancel an active reservation (e.g. if pre-call checks fail or request aborted)
     */
    cancelReservation(scopeId, reservationId, reason = 'Cancelled by caller') {
        const scope = this.getScopeInstance(scopeId);
        const reservation = scope.activeReservations.get(reservationId);

        if (!reservation) {
            return false;
        }

        scope.reserved.inputTokens = Math.max(0, scope.reserved.inputTokens - reservation.estimatedInputTokens);
        scope.reserved.outputTokens = Math.max(0, scope.reserved.outputTokens - reservation.estimatedOutputTokens);
        scope.reserved.apiCalls = Math.max(0, scope.reserved.apiCalls - 1);
        scope.reserved.activeCount = Math.max(0, scope.reserved.activeCount - 1);

        reservation.status = RESERVATION_STATUS.CANCELLED;
        scope.activeReservations.delete(reservationId);
        scope.telemetry.reservationsCancelled += 1;

        this.emit('budget:reservation_cancelled', {
            scopeId,
            reservationId,
            reason
        });

        return true;
    }

    /**
     * Clean expired reservations that were never reconciled
     */
    cleanExpiredReservations() {
        const now = Date.now();
        for (const [scopeId, scope] of this.scopes.entries()) {
            if (scope.status !== SCOPE_STATUS.ACTIVE) continue;

            for (const [resId, res] of scope.activeReservations.entries()) {
                if (now > res.expiresAt && res.status === RESERVATION_STATUS.PENDING) {
                    scope.reserved.inputTokens = Math.max(0, scope.reserved.inputTokens - res.estimatedInputTokens);
                    scope.reserved.outputTokens = Math.max(0, scope.reserved.outputTokens - res.estimatedOutputTokens);
                    scope.reserved.apiCalls = Math.max(0, scope.reserved.apiCalls - 1);
                    scope.reserved.activeCount = Math.max(0, scope.reserved.activeCount - 1);

                    res.status = RESERVATION_STATUS.EXPIRED;
                    scope.activeReservations.delete(resId);
                    scope.telemetry.reservationsExpired += 1;

                    this.emit('budget:reservation_expired', {
                        scopeId,
                        reservationId: resId,
                        expiredAt: now
                    });
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. STEP/TOOL/ITERATION RECORDERS
    // ─────────────────────────────────────────────────────────────────────────

    recordIteration(scopeId) {
        const scope = this.getScopeInstance(scopeId);
        scope.assertOperational();

        if (scope.consumed.agentLoopIterations >= scope.limits.maxAgentLoopIterations) {
            throw new BudgetExceededError(
                scopeId,
                'agentLoopIterations',
                scope.consumed.agentLoopIterations + 1,
                0,
                scope.limits.maxAgentLoopIterations
            );
        }

        scope.consumed.agentLoopIterations += 1;
        return {
            current: scope.consumed.agentLoopIterations,
            max: scope.limits.maxAgentLoopIterations,
            remaining: scope.limits.maxAgentLoopIterations - scope.consumed.agentLoopIterations
        };
    }

    recordToolCall(scopeId, count = 1) {
        const scope = this.getScopeInstance(scopeId);
        scope.assertOperational();

        const remaining = scope.limits.maxToolCalls - scope.consumed.toolCalls;
        if (count > remaining) {
            throw new BudgetExceededError(
                scopeId,
                'toolCalls',
                count,
                remaining,
                scope.limits.maxToolCalls
            );
        }

        scope.consumed.toolCalls += count;
        return {
            current: scope.consumed.toolCalls,
            max: scope.limits.maxToolCalls,
            remaining: scope.limits.maxToolCalls - scope.consumed.toolCalls
        };
    }

    recordRetry(scopeId) {
        const scope = this.getScopeInstance(scopeId);
        scope.assertOperational();

        const remaining = scope.limits.maxRetries - scope.consumed.retries;
        if (remaining <= 0) {
            throw new BudgetExceededError(
                scopeId,
                'retries',
                scope.consumed.retries + 1,
                0,
                scope.limits.maxRetries
            );
        }

        scope.consumed.retries += 1;
        return {
            current: scope.consumed.retries,
            max: scope.limits.maxRetries,
            remaining: scope.limits.maxRetries - scope.consumed.retries
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. INSPECTION & TELEMETRY
    // ─────────────────────────────────────────────────────────────────────────

    getScope(scopeId) {
        return this.getScopeSummary(scopeId);
    }

    getRemaining(scopeId) {
        const scope = this.getScopeInstance(scopeId);
        return scope.getRemaining();
    }

    getTelemetry(scopeId) {
        const scope = this.getScopeInstance(scopeId);
        return {
            scopeId: scope.id,
            scopeType: scope.type,
            domain: scope.domain,
            profile: scope.profile,
            status: scope.status,
            createdAt: scope.createdAt,
            durationMs: scope.completedAt ? scope.durationMs : Date.now() - scope.createdAt,
            consumed: { ...scope.consumed },
            remaining: scope.getRemaining(),
            reservations: {
                active: scope.reserved.activeCount,
                created: scope.telemetry.reservationsCreated,
                reconciled: scope.telemetry.reservationsReconciled,
                cancelled: scope.telemetry.reservationsCancelled,
                expired: scope.telemetry.reservationsExpired
            },
            providerUsage: { ...scope.telemetry.providerCalls },
            children: scope.childScopeIds
        };
    }

    /**
     * Global telemetry segregated by Domain (Zero Co-Mingling)
     */
    getGlobalTelemetry(domainFilter = null) {
        const result = {
            totalScopes: 0,
            activeScopes: 0,
            completedScopes: 0,
            exhaustedScopes: 0,
            cancelledScopes: 0,
            byDomain: {
                [SCOPE_DOMAINS.DEVELOPMENT]: {
                    scopesCount: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    apiCalls: 0,
                    toolCalls: 0,
                    estimatedCostUsd: 0
                },
                [SCOPE_DOMAINS.RUNTIME]: {
                    scopesCount: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    apiCalls: 0,
                    toolCalls: 0,
                    estimatedCostUsd: 0
                }
            }
        };

        for (const scope of this.scopes.values()) {
            if (domainFilter && scope.domain !== domainFilter) continue;

            result.totalScopes += 1;
            if (scope.status === SCOPE_STATUS.ACTIVE) result.activeScopes += 1;
            else if (scope.status === SCOPE_STATUS.COMPLETED) result.completedScopes += 1;
            else if (scope.status === SCOPE_STATUS.EXHAUSTED) result.exhaustedScopes += 1;
            else if (scope.status === SCOPE_STATUS.CANCELLED) result.cancelledScopes += 1;

            const d = result.byDomain[scope.domain];
            if (d) {
                d.scopesCount += 1;
                d.inputTokens += scope.consumed.inputTokens;
                d.outputTokens += scope.consumed.outputTokens;
                d.apiCalls += scope.consumed.apiCalls;
                d.toolCalls += scope.consumed.toolCalls;
                d.estimatedCostUsd += scope.consumed.estimatedCostUsd;
            }
        }

        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    getScopeInstance(scopeId) {
        const scope = this.scopes.get(scopeId);
        if (!scope) {
            throw new BudgetError(`Budget scope [${scopeId}] does not exist`);
        }
        return scope;
    }

    getScopeSummary(scopeId) {
        const scope = this.getScopeInstance(scopeId);
        return {
            scopeId: scope.id,
            scopeType: scope.type,
            domain: scope.domain,
            profile: scope.profile,
            status: scope.status,
            depth: scope.depth,
            parentScopeId: scope.parentScopeId,
            limits: { ...scope.limits },
            consumed: { ...scope.consumed },
            remaining: scope.getRemaining(),
            reserve: {
                isLocked: scope.reserve.isLocked,
                percent: scope.reserve.percent,
                inputTokens: scope.reserve.inputTokens,
                outputTokens: scope.reserve.outputTokens,
                releasedAt: scope.reserve.releasedAt,
                releaseReason: scope.reserve.releaseReason
            }
        };
    }
}

// Export singleton instance for app-wide runtime governance
export const budgetManager = new BudgetManager();
export default budgetManager;
