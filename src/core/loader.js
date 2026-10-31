// src/core/loader.js
// Backward-compatibility bridge delegating to src/core/registry.js
import {
    initializeRegistry,
    commands,
    getCommand,
    getAllCommands,
    getCommandsByCategory,
    getToolSchemas,
    generatePromptToolDefinitions,
    CANONICAL_CATEGORIES,
    normalizeCategory,
    isAllowedForRole,
    compileParameters
} from './registry.js'

export {
    commands,
    initializeRegistry,
    getCommand,
    getAllCommands,
    getCommandsByCategory,
    getToolSchemas,
    generatePromptToolDefinitions,
    CANONICAL_CATEGORIES,
    normalizeCategory,
    isAllowedForRole,
    compileParameters
}

/**
 * Legacy loader function for backward compatibility.
 * Re-exports the commands Map and delegates loading to initializeRegistry.
 */
export async function loadCommands(dir = './src/commands') {
    return initializeRegistry(dir)
}