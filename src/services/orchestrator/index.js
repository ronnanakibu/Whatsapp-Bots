/**
 * src/services/orchestrator/index.js
 * 
 * Central Unified Barrel Export for Milestone 2 & Milestone 3 Resource-Aware Agent Orchestration
 * WABOT 2.0 v6 Autonomous AI Operating System
 */

// 1. Budget Configuration & Dual-Scope Enums
export {
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

// 2. Budget Manager & Custom Error Hierarchy
export {
    BudgetManager,
    budgetManager,
    BudgetError,
    BudgetExceededError,
    ScopeExhaustedError,
    ReserveLockedError,
    BudgetDomainViolationError,
    SubAgentDelegationError,
    ReservationNotFoundError,
    ConcurrencyLimitExceededError,
    ExecutionTimeoutError
} from './budgetManager.js';

// 3. Provider Health, Circuit Breaker & Failover
export {
    CircuitState,
    ErrorCategory,
    DEFAULT_CIRCUIT_CONFIG,
    ErrorClassifier,
    ProviderMetrics,
    CircuitBreaker,
    PROVIDER_CATALOG,
    ProviderHealthManager,
    providerHealth
} from './providerHealth.js';

// 4. Tiered Model Routing (Tier 0-3)
export {
    MODEL_TIERS,
    TASK_COMPLEXITY,
    TIER_CONFIGS,
    ModelTierRouter,
    modelTierRouter
} from './modelTierRouter.js';

// 5. Context & Tool Schema Pruning Engine
export {
    ContextEngine,
    contextEngine
} from './contextEngine.js';

// 6. Centralized Runtime Orchestrator & Loop Control (Milestone 3)
export {
    RuntimeOrchestrator,
    orchestrator,
    TERMINATION_REASONS,
    TASK_STATUS,
    PRIVILEGE_LEVELS
} from './orchestrator.js';

// Default orchestrator bundle
import config from './config.js';
import budgetManager from './budgetManager.js';
import providerHealth from './providerHealth.js';
import modelTierRouter from './modelTierRouter.js';
import contextEngine from './contextEngine.js';
import { RuntimeOrchestrator, orchestrator, TERMINATION_REASONS, TASK_STATUS, PRIVILEGE_LEVELS } from './orchestrator.js';

export default {
    config,
    budgetManager,
    providerHealth,
    modelTierRouter,
    contextEngine,
    RuntimeOrchestrator,
    orchestrator,
    TERMINATION_REASONS,
    TASK_STATUS,
    PRIVILEGE_LEVELS
};
