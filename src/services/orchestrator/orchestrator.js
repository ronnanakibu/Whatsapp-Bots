/**
 * src/services/orchestrator/orchestrator.js
 * 
 * Central Runtime Orchestrator for WABOT 2.0 v6 Autonomous AI Operating System.
 * 
 * Implements:
 * - Phase 2C, 2D, 2E Runtime Orchestrator Architecture
 * - Bounded Multi-Step Agent Execution Loop
 * - 7 Explicit Loop Termination Conditions
 * - Anti-Loop SHA-256 State Hashing & Sliding Window Detection
 * - Sub-Agent Concurrency Limits (single-agent default, depth 1, max 3 cumulative, max 2 concurrent)
 * - WhatsApp Entity & Context Binding (aku, kamu, grup ini, orang tadi, pesan itu)
 * - Privilege Audit Logging with in-memory ring buffer
 * - Automatic 7-step pre-reservation, provider failover & post-reconciliation
 */

import crypto from 'crypto';
import EventEmitter from 'events';
import { budgetManager } from './budgetManager.js';
import { providerHealth } from './providerHealth.js';
import { modelTierRouter, MODEL_TIERS } from './modelTierRouter.js';
import { contextEngine } from './contextEngine.js';
import { SCOPE_TYPES, BUDGET_SETTINGS, RESERVE_RELEASE_REASONS } from './config.js';

/**
 * Seven Explicit Termination Conditions (Phase 2D)
 */
export const TERMINATION_REASONS = Object.freeze({
    GOAL_ACHIEVED: 'GOAL_ACHIEVED',
    NO_TOOL_AVAILABLE: 'NO_TOOL_AVAILABLE',
    LOOP_DETECTED: 'LOOP_DETECTED',
    ITERATION_BUDGET_EXHAUSTED: 'ITERATION_BUDGET_EXHAUSTED',
    PROVIDER_BUDGET_EXHAUSTED: 'PROVIDER_BUDGET_EXHAUSTED',
    EXECUTION_TIMEOUT_EXCEEDED: 'EXECUTION_TIMEOUT_EXCEEDED',
    PERMISSION_DENIED: 'PERMISSION_DENIED'
});

/**
 * Task Execution States
 */
export const TASK_STATUS = Object.freeze({
    INITIALIZED: 'INITIALIZED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED'
});

/**
 * Privilege Levels
 */
export const PRIVILEGE_LEVELS = Object.freeze({
    OWNER: 'owner',
    ADMIN: 'admin',
    USER: 'user'
});

export class RuntimeOrchestrator extends EventEmitter {
    constructor(options = {}) {
        super();
        this.budget = options.budgetManager || budgetManager;
        this.health = options.providerHealth || providerHealth;
        this.router = options.modelTierRouter || modelTierRouter;
        this.contextEngine = options.contextEngine || contextEngine;

        // In-memory active tasks ledger
        this.tasks = new Map();

        // Privilege audit log ring buffer (default 1000 items)
        this.maxAuditEntries = options.maxAuditEntries || 1000;
        this.auditLog = [];

        // Tool executor callback hook: (commandName, args, ctx) => Promise<{ result, success, error }>
        this.toolExecutor = options.toolExecutor || null;

        // Model provider call hook: (prompt, candidate, context) => Promise<{ text, model, reportedTokens, toolCalls }>
        this.llmExecutor = options.llmExecutor || null;
    }

    /**
     * Resolves natural language pronouns to verified WhatsApp context entities (Phase 2E)
     */
    resolveWhatsAppEntities(userQuery, waContext = {}) {
        const query = String(userQuery || '');
        const senderJid = waContext.sender || waContext.senderJid || 'user@s.whatsapp.net';
        const botJid = waContext.botJid || waContext.sock?.user?.id?.split(':')[0] + '@s.whatsapp.net' || 'bot@s.whatsapp.net';
        const isGroup = Boolean(waContext.isGroup || waContext.chatId?.endsWith('@g.us') || waContext.remoteJid?.endsWith('@g.us'));
        const chatId = waContext.chatId || waContext.remoteJid || (isGroup ? 'group@g.us' : senderJid);
        
        const entities = {
            senderJid,
            botJid,
            chatId,
            isGroup,
            senderPushName: waContext.pushName || waContext.senderPushName || 'User',
            senderRole: waContext.senderRole || (waContext.isOwner ? 'owner' : (waContext.isAdmin ? 'admin' : 'user')),
            quotedParticipant: waContext.quoted?.sender || null,
            quotedText: waContext.quoted?.text || null,
            quotedMedia: waContext.quoted?.media || null
        };

        // Semantic entity extraction mappings
        const bindings = {};
        if (/\b(aku|saya|gue|gw)\b/i.test(query)) {
            bindings.targetUserJid = entities.senderJid;
            bindings.targetUserName = entities.senderPushName;
        }
        if (/\b(kamu|bot|lu)\b/i.test(query)) {
            bindings.botTargetJid = entities.botJid;
        }
        if (/\b(grup ini|sini)\b/i.test(query)) {
            bindings.targetChatId = entities.isGroup ? entities.chatId : null;
        }
        if (/\b(orang (yang )?tadi|dia)\b/i.test(query) && entities.quotedParticipant) {
            bindings.targetUserJid = entities.quotedParticipant;
        }

        return { entities, bindings };
    }

    /**
     * Computes a deterministic SHA-256 state hash for loop detection
     */
    computeStateHash(toolName, args, result) {
        const stableStringify = (obj) => {
            if (obj === null || typeof obj !== 'object') return String(obj);
            if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
            const sortedKeys = Object.keys(obj).sort();
            return '{' + sortedKeys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
        };

        const signature = `${toolName}::${stableStringify(args)}::${stableStringify(result)}`;
        return crypto.createHash('sha256').update(signature).digest('hex');
    }

    /**
     * Records an audit log entry for privileged operations
     */
    recordAudit(entry) {
        const auditRecord = {
            timestamp: new Date().toISOString(),
            auditId: crypto.randomUUID(),
            taskId: entry.taskId || 'unknown',
            scopeId: entry.scopeId || 'unknown',
            operation: entry.operation || 'unknown',
            actorJid: entry.actorJid || 'system',
            targetJid: entry.targetJid || null,
            privilegeLevel: entry.privilegeLevel || PRIVILEGE_LEVELS.USER,
            parameters: entry.parameters || {},
            resultStatus: entry.resultStatus || 'UNKNOWN',
            error: entry.error ? String(entry.error) : null
        };

        this.auditLog.push(auditRecord);
        if (this.auditLog.length > this.maxAuditEntries) {
            this.auditLog.shift();
        }

        this.emit('audit', auditRecord);
        return auditRecord;
    }

    /**
     * Retrieves recent audit log records with optional filtering
     */
    getAuditLogs(filter = {}) {
        return this.auditLog.filter(record => {
            if (filter.taskId && record.taskId !== filter.taskId) return false;
            if (filter.actorJid && record.actorJid !== filter.actorJid) return false;
            if (filter.operation && record.operation !== filter.operation) return false;
            if (filter.privilegeLevel && record.privilegeLevel !== filter.privilegeLevel) return false;
            return true;
        });
    }

    /**
     * Executes an autonomous request with bounded loop control and resource governance
     */
    async executeTask(taskDefinition, waContext = {}, options = {}) {
        const taskId = `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const query = taskDefinition.query || taskDefinition.prompt || '';
        const scopeType = options.scopeType || SCOPE_TYPES.RUNTIME_TASK;
        const profile = options.profile || 'standard';

        // 1. Resolve WhatsApp Context Entities (Phase 2E)
        const { entities, bindings } = this.resolveWhatsAppEntities(query, waContext);

        // 2. Dual-scope budget creation
        const scope = this.budget.createScope(scopeType, {
            profile,
            metadata: { taskId, senderJid: entities.senderJid, chatId: entities.chatId }
        });

        // 3. Register task instance in memory ledger
        const taskInstance = {
            taskId,
            scopeId: scope.scopeId,
            status: TASK_STATUS.RUNNING,
            profile,
            query,
            entities,
            bindings,
            iterations: 0,
            toolCalls: 0,
            stateHashes: [],
            childTasks: [],
            activeChildCount: 0,
            terminationReason: null,
            startTime: Date.now(),
            steps: [],
            finalResult: null
        };
        this.tasks.set(taskId, taskInstance);

        // Setup AbortController for execution timeout
        const maxDurationMs = scope.limits.maxExecutionDurationMs || 30000;
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            abortController.abort(new Error(`Execution timeout of ${maxDurationMs}ms exceeded`));
        }, maxDurationMs);

        try {
            // Check explicit tool permissions up-front if query directly invokes a tool
            if (options.tools && Array.isArray(options.tools)) {
                for (const toolDef of options.tools) {
                    if (toolDef.permissions && Array.isArray(toolDef.permissions)) {
                        const requiredRole = toolDef.permissions.includes('owner') ? 'owner' : (toolDef.permissions.includes('admin') ? 'admin' : 'user');
                        const matchesTool = query.toLowerCase().includes(toolDef.name.toLowerCase());
                        if (matchesTool && requiredRole === 'owner' && entities.senderRole !== 'owner') {
                            this.recordAudit({
                                taskId,
                                scopeId: scope.scopeId,
                                operation: toolDef.name,
                                actorJid: entities.senderJid,
                                privilegeLevel: PRIVILEGE_LEVELS.OWNER,
                                resultStatus: 'BLOCKED',
                                error: 'Permission denied: requires owner'
                            });
                            return this._terminate(taskId, TERMINATION_REASONS.PERMISSION_DENIED, `Tool ${toolDef.name} requires owner permission`);
                        }
                    }
                }
            }

            // 4. Extract intent and route Model Tier (Tier 0-3)
            const intent = this.contextEngine.extractTaskIntent(query);
            const routingDecision = this.router.routeTask(intent, {
                budgetScope: scope,
                providerHealth: this.health,
                forcedTier: options.forcedTier
            });

            // Fast-path: Tier 0 Deterministic Engine (0 LLM Tokens, 0 API Calls)
            // Only trigger if options.tools is not explicitly supplied or llmExecutor is not forcing model execution
            if (routingDecision.isDeterministic && routingDecision.directResult !== null && !options.tools?.length && !this.llmExecutor) {
                taskInstance.status = TASK_STATUS.COMPLETED;
                taskInstance.terminationReason = TERMINATION_REASONS.GOAL_ACHIEVED;
                taskInstance.finalResult = routingDecision.directResult;

                if (!options.keepScopeAlive) {
                    this.budget.completeScope(scope.scopeId);
                }
                return {
                    success: true,
                    taskId,
                    tier: MODEL_TIERS.TIER_0_DETERMINISTIC,
                    result: routingDecision.directResult,
                    terminationReason: TERMINATION_REASONS.GOAL_ACHIEVED,
                    iterations: 0,
                    tokensUsed: { input: 0, output: 0 },
                    telemetry: this.budget.getTelemetry(scope.scopeId)
                };
            }

            // 5. Context Engineering & Progressive Tool Schema Pruning
            const optimizedContext = await this.contextEngine.buildOptimizedContext(entities.chatId, query, {
                tools: options.tools || [],
                role: entities.senderRole,
                maxTurns: 5
            });

            // Termination Condition 2: No tools available and prompt requires tools
            if (optimizedContext.prunedTools.length === 0 && options.requireTools) {
                return this._terminate(taskId, TERMINATION_REASONS.NO_TOOL_AVAILABLE, 'No tools available for the requested intent');
            }

            // 6. Bounded Autonomous Multi-Step Agent Loop
            const maxIterations = options.maxIterations || scope.limits.maxAgentLoopIterations || 3;
            let currentContextMessages = [
                { role: 'system', content: `Kamu adalah asisten otonom WABOT 2.0. Penanya: ${entities.senderPushName} (${entities.senderJid}). Grup: ${entities.isGroup ? entities.chatId : 'Bukan grup'}. Gunakan alat yang tersedia secara efektif.` },
                { role: 'user', content: query }
            ];

            let lastAssistantResponse = null;

            while (taskInstance.iterations < maxIterations) {
                // Check if aborted by timeout
                if (abortController.signal.aborted) {
                    return this._terminate(taskId, TERMINATION_REASONS.EXECUTION_TIMEOUT_EXCEEDED, abortController.signal.reason?.message || 'Timeout exceeded');
                }

                taskInstance.iterations++;

                // Check Termination Condition 5: Provider/Token Budget Exhausted
                const remainingBudget = this.budget.getRemaining(scope.scopeId);
                if (remainingBudget.inputTokens <= 0 || remainingBudget.outputTokens <= 0 || remainingBudget.apiCalls <= 0) {
                    return this._terminate(taskId, TERMINATION_REASONS.PROVIDER_BUDGET_EXHAUSTED, 'Remaining token or API call budget is exhausted');
                }

                // Step A: Reserve budget for LLM call
                const estTokens = routingDecision.estimatedTokens || { input: 500, output: 250 };
                const reservationId = this.budget.reserve(scope.scopeId, {
                    estimatedInputTokens: estTokens.input,
                    estimatedOutputTokens: estTokens.output,
                    modelTier: routingDecision.tier,
                    provider: routingDecision.provider,
                    model: routingDecision.model
                });

                // Step B: Call LLM (via llmExecutor if provided, or via Provider Health Failover)
                let llmResult;
                if (this.llmExecutor) {
                    const candidate = {
                        provider: routingDecision.provider,
                        model: routingDecision.model,
                        tier: routingDecision.tier
                    };
                    const res = await this.llmExecutor(query, candidate, {
                        messages: currentContextMessages,
                        tools: optimizedContext.prunedTools,
                        signal: abortController.signal,
                        iteration: taskInstance.iterations
                    });
                    llmResult = {
                        text: res.text,
                        provider: candidate.provider,
                        model: res.model || candidate.model,
                        toolCalls: res.toolCalls || [],
                        reconciliation: {
                            actualInputTokens: res.reportedTokens?.inputTokens || 250,
                            actualOutputTokens: res.reportedTokens?.outputTokens || 80
                        },
                        latencyMs: 100
                    };
                } else {
                    const llmCallable = async (candidate, normCtx) => {
                        return {
                            text: `Respon otonom untuk: ${query}`,
                            model: candidate.model,
                            reportedTokens: { inputTokens: 250, outputTokens: 80, totalTokens: 330 },
                            toolCalls: []
                        };
                    };

                    try {
                        const failoverRes = await this.health.executeWithFailover(query, llmCallable, {
                            tier: routingDecision.tier,
                            requirements: { capabilities: ['text'] },
                            messages: currentContextMessages
                        });
                        llmResult = {
                            ...failoverRes,
                            toolCalls: []
                        };
                    } catch (err) {
                        this.budget.cancelReservation(scope.scopeId, reservationId);
                        throw err;
                    }
                }

                // Step C: Reconcile LLM usage immediately
                this.budget.reconcile(scope.scopeId, reservationId, {
                    actualInputTokens: llmResult.reconciliation?.actualInputTokens || 250,
                    actualOutputTokens: llmResult.reconciliation?.actualOutputTokens || 80,
                    latencyMs: llmResult.latencyMs || 100,
                    provider: llmResult.provider,
                    model: llmResult.model
                });

                lastAssistantResponse = llmResult.text;

                // Step D: Evaluate tool calls
                const requestedToolCalls = llmResult.toolCalls || [];

                // Termination Condition 1: Objective Complete (No further tool calls requested)
                if (requestedToolCalls.length === 0) {
                    taskInstance.status = TASK_STATUS.COMPLETED;
                    taskInstance.terminationReason = TERMINATION_REASONS.GOAL_ACHIEVED;
                    taskInstance.finalResult = lastAssistantResponse;
                    if (!options.keepScopeAlive) {
                        this.budget.completeScope(scope.scopeId);
                    }

                    return {
                        success: true,
                        taskId,
                        tier: routingDecision.tier,
                        result: lastAssistantResponse,
                        terminationReason: TERMINATION_REASONS.GOAL_ACHIEVED,
                        iterations: taskInstance.iterations,
                        telemetry: this.budget.getTelemetry(scope.scopeId)
                    };
                }

                // Step E: Execute requested tools sequentially
                for (const call of requestedToolCalls) {
                    taskInstance.toolCalls++;

                    const toolName = call.name || call.function?.name;
                    const toolArgs = call.args || (typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function?.arguments || {}));

                    // Permission & Security Check (Phase 2E)
                    const targetToolDef = (options.tools || []).find(t => t.name === toolName);
                    if (targetToolDef && Array.isArray(targetToolDef.permissions)) {
                        const requiredRole = targetToolDef.permissions.includes('owner') ? 'owner' : (targetToolDef.permissions.includes('admin') ? 'admin' : 'user');
                        if (requiredRole === 'owner' && entities.senderRole !== 'owner') {
                            this.recordAudit({
                                taskId,
                                scopeId: scope.scopeId,
                                operation: toolName,
                                actorJid: entities.senderJid,
                                privilegeLevel: PRIVILEGE_LEVELS.OWNER,
                                resultStatus: 'BLOCKED',
                                error: 'Permission denied: requires owner'
                            });
                            return this._terminate(taskId, TERMINATION_REASONS.PERMISSION_DENIED, `Tool ${toolName} requires owner permission`);
                        }
                    }

                    // Execute tool
                    let execOutput;
                    if (this.toolExecutor) {
                        try {
                            execOutput = await this.toolExecutor(toolName, toolArgs, waContext);
                        } catch (toolErr) {
                            execOutput = { success: false, error: toolErr.message };
                        }
                    } else {
                        execOutput = { success: true, result: `Executed ${toolName}` };
                    }

                    // Audit privileged tool execution
                    this.recordAudit({
                        taskId,
                        scopeId: scope.scopeId,
                        operation: toolName,
                        actorJid: entities.senderJid,
                        parameters: toolArgs,
                        privilegeLevel: targetToolDef?.permissions?.[0] || PRIVILEGE_LEVELS.USER,
                        resultStatus: execOutput.success ? 'SUCCESS' : 'FAILED',
                        error: execOutput.error || null
                    });

                    // Anti-Loop State Hashing (Phase 2D - Condition 3)
                    const stateHash = this.computeStateHash(toolName, toolArgs, execOutput);
                    const identicalConsecutive = taskInstance.stateHashes.length > 0 && taskInstance.stateHashes[taskInstance.stateHashes.length - 1] === stateHash;
                    const identicalFrequency = taskInstance.stateHashes.filter(h => h === stateHash).length;

                    if (identicalConsecutive || identicalFrequency >= 2) {
                        return this._terminate(taskId, TERMINATION_REASONS.LOOP_DETECTED, `Identical tool call loop detected for tool "${toolName}"`);
                    }
                    taskInstance.stateHashes.push(stateHash);

                    // Append tool execution back to conversation context
                    currentContextMessages.push({
                        role: 'assistant',
                        content: null,
                        tool_calls: [call]
                    });
                    currentContextMessages.push({
                        role: 'tool',
                        name: toolName,
                        content: typeof execOutput === 'string' ? execOutput : JSON.stringify(execOutput)
                    });
                }
            }

            // Condition 4: Iteration budget reached
            return this._terminate(taskId, TERMINATION_REASONS.ITERATION_BUDGET_EXHAUSTED, `Max iteration loop count (${maxIterations}) reached without full completion`);

        } catch (err) {
            taskInstance.status = TASK_STATUS.FAILED;
            taskInstance.finalResult = null;
            try { this.budget.completeScope(scope.scopeId); } catch (_) {}
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Delegates a bounded sub-agent task adhering strictly to Document 2 fan-out bounds:
     * - Default to single agent
     * - Max 3 cumulative sub-agents per parent task
     * - Max 2 concurrent active sub-agents
     * - Strictly depth 1 delegation (sub-agents cannot spawn sub-agents)
     */
    async delegateSubAgent(parentTaskId, subTaskDefinition, options = {}) {
        const parentTask = this.tasks.get(parentTaskId);
        if (!parentTask) {
            throw new Error(`Parent task "${parentTaskId}" not found in orchestrator ledger`);
        }

        // Enforce max 3 cumulative sub-agents per parent task
        if (parentTask.childTasks.length >= BUDGET_SETTINGS.maxSubAgentsPerTask) {
            throw new Error(`Cannot spawn sub-agent: Cumulative limit of ${BUDGET_SETTINGS.maxSubAgentsPerTask} sub-agents per parent task reached`);
        }

        // Enforce max 2 concurrent active sub-agents
        if (parentTask.activeChildCount >= BUDGET_SETTINGS.maxConcurrentSubAgents) {
            throw new Error(`Cannot spawn sub-agent: Concurrency limit of ${BUDGET_SETTINGS.maxConcurrentSubAgents} active sub-agents reached`);
        }

        // Create child budget scope with strict depth 1 check
        const childScope = this.budget.createChildScope(parentTask.scopeId, {
            budgetAllocation: options.budgetAllocation || {
                inputTokens: 3000,
                outputTokens: 1000,
                apiCalls: 2
            }
        });

        const subTaskId = `subtask_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        parentTask.childTasks.push(subTaskId);
        parentTask.activeChildCount++;

        const subTaskInstance = {
            taskId: subTaskId,
            parentTaskId,
            scopeId: childScope.scopeId,
            status: TASK_STATUS.RUNNING,
            depth: childScope.depth,
            startTime: Date.now()
        };
        this.tasks.set(subTaskId, subTaskInstance);

        try {
            // Execute sub-task query
            const result = await this.executeTask(subTaskDefinition, parentTask.entities, {
                scopeType: SCOPE_TYPES.RUNTIME_SUBAGENT,
                tools: options.tools || []
            });

            subTaskInstance.status = TASK_STATUS.COMPLETED;
            subTaskInstance.finalResult = result;
            return result;
        } catch (err) {
            subTaskInstance.status = TASK_STATUS.FAILED;
            throw err;
        } finally {
            parentTask.activeChildCount = Math.max(0, parentTask.activeChildCount - 1);
            try { this.budget.completeScope(childScope.scopeId); } catch (_) {}
        }
    }

    /**
     * Terminates a task atomically with structured reason and budget reconciliation
     */
    _terminate(taskId, reason, message) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = (reason === TERMINATION_REASONS.GOAL_ACHIEVED) ? TASK_STATUS.COMPLETED : TASK_STATUS.FAILED;
            task.terminationReason = reason;
            try { this.budget.completeScope(task.scopeId); } catch (_) {}
        }

        return {
            success: reason === TERMINATION_REASONS.GOAL_ACHIEVED,
            taskId,
            terminationReason: reason,
            message,
            iterations: task?.iterations || 0,
            telemetry: task ? this.budget.getTelemetry(task.scopeId) : null
        };
    }

    /**
     * Retrieves status of a task by ID
     */
    getTaskStatus(taskId) {
        return this.tasks.get(taskId) || null;
    }
}

export const orchestrator = new RuntimeOrchestrator();

export default {
    RuntimeOrchestrator,
    orchestrator,
    TERMINATION_REASONS,
    TASK_STATUS,
    PRIVILEGE_LEVELS
};
