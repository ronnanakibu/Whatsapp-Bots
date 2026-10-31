// src/core/registry.js
// Unified Tool & Command Registry for WABOT2.0 Autonomous AI Operating System
import { readdirSync, statSync, existsSync } from 'fs'
import path from 'path'
import { pathToFileURL, fileURLToPath } from 'url'
import { logger } from '../utils/logger.js'

// ─────────────────────────────────────────────
// CANONICAL 9-CATEGORY TAXONOMY
// ─────────────────────────────────────────────

export const CANONICAL_CATEGORIES = [
    'ai',
    'media',
    'downloader',
    'tools',
    'audio',
    'group',
    'general',
    'entertainment',
    'owner'
]

const CATEGORY_MAP = {
    // Tools / Utility
    'utility': 'tools',
    'util': 'tools',
    'tool': 'tools',
    'tools': 'tools',

    // Audio / Radio
    'radio': 'audio',
    'music': 'audio',
    'audio': 'audio',

    // Group / Admin
    'admin': 'group',
    'group': 'group',

    // Entertainment
    'entertainments': 'entertainment',
    'entertainment': 'entertainment',
    'game': 'entertainment',
    'games': 'entertainment',

    // Downloader
    'downloader': 'downloader',
    'download': 'downloader',

    // Media
    'media': 'media',
    'image': 'media',
    'video': 'media',
    'sticker': 'media',

    // AI
    'ai': 'ai',

    // General
    'general': 'general',
    'info': 'general',

    // Owner
    'owner': 'owner'
}

/**
 * Normalizes any category string into one of the 9 canonical categories.
 */
export function normalizeCategory(category, commandName = '') {
    if (commandName === 'dl') return 'downloader'
    if (!category || typeof category !== 'string') return 'general'
    const lower = category.toLowerCase().trim()
    return CATEGORY_MAP[lower] || (CANONICAL_CATEGORIES.includes(lower) ? lower : 'general')
}

// ─────────────────────────────────────────────
// REGISTRY STORAGE & CACHES
// ─────────────────────────────────────────────

// Primary index: canonical name -> Normalized Command (unique commands)
const commandsByName = new Map()

// Alias index: alias -> canonical name
const aliases = new Map()

// Category index: canonical category -> Array of Normalized Commands
const commandsByCategory = new Map()

// Backward-compatible flat Map: contains canonical names AND aliases
export const commands = new Map()

// Compiled schema & prompt caches for O(1) performance
const schemaCache = new Map()
const promptCache = new Map()

// Concurrency mutex to prevent duplicate concurrent initialization
let initializationPromise = null

/**
 * Check if a command is permitted for a given role ('user' | 'admin' | 'owner')
 */
export function isAllowedForRole(command, role = 'user') {
    const requiredPermission = command.permissions?.[0] ?? 'user'
    if (role === 'owner') return true
    if (role === 'admin') return requiredPermission === 'user' || requiredPermission === 'admin'
    return requiredPermission === 'user'
}

// ─────────────────────────────────────────────
// INITIALIZATION & DYNAMIC LOADING
// ─────────────────────────────────────────────

/**
 * Recursively scans and loads all command modules into the Unified Registry.
 */
export async function initializeRegistry(dir = './src/commands') {
    if (initializationPromise) {
        return initializationPromise
    }

    initializationPromise = _performInitialization(dir, true)
    try {
        const result = await initializationPromise
        return result
    } finally {
        initializationPromise = null
    }
}

async function _performInitialization(dir, isRoot = true) {
    let resolvedDir = dir
    if (isRoot) {
        if (!existsSync(resolvedDir)) {
            const fallbackDir = fileURLToPath(new URL('../commands', import.meta.url))
            if (existsSync(fallbackDir)) {
                resolvedDir = fallbackDir
            }
        }
        commandsByName.clear()
        aliases.clear()
        commandsByCategory.clear()
        commands.clear()
        schemaCache.clear()
        promptCache.clear()

        for (const cat of CANONICAL_CATEGORIES) {
            commandsByCategory.set(cat, [])
        }
    }

    let entries = []
    try {
        entries = readdirSync(resolvedDir)
    } catch (err) {
        process.stdout.write(`\n❌ [Registry Error] Gagal membaca folder ${resolvedDir}: ${err.message}\n`)
        return { loadedCount: commandsByName.size, totalEntries: commands.size }
    }

    for (const entry of entries) {
        const fullPath = path.join(resolvedDir, entry)
        const isDir = statSync(fullPath).isDirectory()

        if (isDir) {
            await _performInitialization(fullPath, false)
            continue
        }

        if (!entry.endsWith('.js')) continue

        try {
            const absolutePath = path.resolve(fullPath)
            const fileURL = pathToFileURL(absolutePath).href

            const mod = await import(fileURL)
            const rawCmd = mod.default

            if (!rawCmd) {
                process.stdout.write(`\n⚠️  [Registry Warning] Berkas ${entry} tidak memiliki 'export default'!\n`)
                continue
            }
            if (!rawCmd.name) {
                process.stdout.write(`\n⚠️  [Registry Warning] Berkas ${entry} kehilangan properti 'name'!\n`)
                continue
            }

            const canonicalName = String(rawCmd.name).toLowerCase().trim()

            // Normalize command metadata
            const cmd = {
                ...rawCmd,
                name: canonicalName,
                aliases: Array.isArray(rawCmd.aliases)
                    ? rawCmd.aliases.map(a => String(a).toLowerCase().trim()).filter(a => a && a !== canonicalName)
                    : [],
                category: normalizeCategory(rawCmd.category, canonicalName),
                description: rawCmd.description || rawCmd.desc || `${canonicalName} command`,
                usage: rawCmd.usage || rawCmd.use || `.${canonicalName}`,
                example: rawCmd.example || '',
                permissions: Array.isArray(rawCmd.permissions) && rawCmd.permissions.length > 0
                    ? rawCmd.permissions
                    : ['user'],
                cooldown: typeof rawCmd.cooldown === 'number' ? rawCmd.cooldown : 3,
                requireBotAdmin: Boolean(rawCmd.requireBotAdmin),
                enabled: rawCmd.enabled !== false,
                tags: Array.isArray(rawCmd.tags) ? rawCmd.tags : [],
                params: rawCmd.params || rawCmd.parameters || undefined,
                filePath: fullPath
            }

            // Conflict detection
            if (commandsByName.has(cmd.name)) {
                const existing = commandsByName.get(cmd.name)
                process.stdout.write(`\n⚠️  [Registry Conflict] Nama command '${cmd.name}' di ${entry} menimpa command yang sudah terdaftar (${existing.name} [kategori: ${existing.category}])!\n`)
            }

            // Index in canonical Map
            commandsByName.set(cmd.name, cmd)

            // Index in legacy Map
            commands.set(cmd.name, cmd)

            // Index category
            if (!commandsByCategory.has(cmd.category)) {
                commandsByCategory.set(cmd.category, [])
            }
            const catList = commandsByCategory.get(cmd.category)
            if (!catList.some(c => c.name === cmd.name)) {
                catList.push(cmd)
            }

            // Index aliases
            for (const alias of cmd.aliases) {
                if (aliases.has(alias) || commandsByName.has(alias)) {
                    process.stdout.write(`\n⚠️  [Registry Conflict] Alias '${alias}' di ${entry} konflik dengan entri yang sudah ada!\n`)
                }
                aliases.set(alias, cmd.name)
                commands.set(alias, cmd) // Maintain legacy map compatibility
            }

            process.stdout.write(`\r\x1b[K🔍 [Registry] Memuat command: ${cmd.name}...`)
            logger.info(`Loaded command: ${cmd.name} [${cmd.category}]`)

        } catch (importErr) {
            if (importErr.code === 'ERR_MODULE_NOT_FOUND') {
                process.stdout.write(`\n⚠️  [Lite Mode] Command ${entry} dilewati (modul dependensi hilang): ${importErr.message.split('\n')[0]}\n`)
            } else {
                process.stdout.write(`\n❌ [Registry Error] Gagal import ${fullPath}: ${importErr.message}\n`)
            }
        }
    }

    if (isRoot) {
        process.stdout.write(`\r\x1b[K✅ [Registry] Berhasil memuat ${commandsByName.size} command unik (${commands.size} total entri dengan alias) ke dalam registry!\n`)
    }

    return {
        loadedCount: commandsByName.size,
        totalEntries: commands.size
    }
}

// ─────────────────────────────────────────────
// REGISTRY ACCESSORS
// ─────────────────────────────────────────────

/**
 * Resolves a command by its primary name or alias.
 * Automatically strips leading command prefixes (., !, /).
 */
export function getCommand(nameOrAlias) {
    if (!nameOrAlias || typeof nameOrAlias !== 'string') return undefined

    const clean = nameOrAlias.replace(/^[.!/]+/, '').toLowerCase().trim()
    if (!clean) return undefined

    // 1. Direct canonical name match
    if (commandsByName.has(clean)) {
        return commandsByName.get(clean)
    }

    // 2. Alias match
    const canonical = aliases.get(clean)
    if (canonical && commandsByName.has(canonical)) {
        return commandsByName.get(canonical)
    }

    // 3. Fallback check in legacy flat map
    if (commands.has(clean)) {
        return commands.get(clean)
    }

    return undefined
}

/**
 * Returns a Map of all unique commands keyed by canonical name.
 */
export function getAllCommands() {
    return commandsByName
}

/**
 * Returns an array of unique command objects in a specific canonical category.
 */
export function getCommandsByCategory(category) {
    const canonical = normalizeCategory(category)
    return commandsByCategory.get(canonical) || []
}

// ─────────────────────────────────────────────
// DYNAMIC TOOL SCHEMA COMPILER (OPENAI JSON SCHEMA)
// ─────────────────────────────────────────────

/**
 * Compiles parameters for a command into a standard JSON Schema object.
 * Supports explicit params/parameters and falls back to smart usage heuristic inference.
 */
export function compileParameters(cmd) {
    const raw = cmd.params || cmd.parameters

    // Case 1: Structured schema provided
    if (raw && typeof raw === 'object') {
        const properties = {}
        const required = Array.isArray(raw.required) ? [...raw.required] : []

        if (raw.properties && typeof raw.properties === 'object') {
            for (const [key, val] of Object.entries(raw.properties)) {
                if (!val || typeof val !== 'object') continue
                properties[key] = {
                    type: val.type || 'string',
                    description: val.description || `Parameter ${key}`
                }
                if (Array.isArray(val.enum)) {
                    properties[key].enum = val.enum
                }
                if (val.required === true && !required.includes(key)) {
                    required.push(key)
                }
            }
        }

        return {
            type: 'object',
            properties,
            required
        }
    }

    // Case 2: Heuristic inference from command.usage
    const usage = cmd.usage || ''
    const bracketMatches = usage.match(/[<[](.*?)[>\]]/g)

    if (bracketMatches && bracketMatches.length > 0) {
        const properties = {}
        const required = []

        bracketMatches.forEach((token, idx) => {
            const rawToken = token.replace(/^[<[]|[>\]]$/g, '').trim()
            const lowerToken = rawToken.toLowerCase()
            let propName = 'query'

            if (lowerToken.includes('url') || lowerToken.includes('link')) {
                propName = 'url'
            } else if (lowerToken.includes('kota') || lowerToken.includes('city') || lowerToken.includes('lokasi')) {
                propName = 'city'
            } else if (lowerToken.includes('teks') || lowerToken.includes('text') || lowerToken.includes('prompt')) {
                propName = 'prompt'
            } else if (lowerToken.includes('jumlah') || lowerToken.includes('count') || lowerToken.includes('angka')) {
                propName = 'count'
            } else if (lowerToken.includes('kode') || lowerToken.includes('code')) {
                propName = 'code'
            } else if (bracketMatches.length === 1) {
                propName = 'query'
            } else {
                propName = `arg_${idx + 1}`
            }

            let finalName = propName
            let counter = 1
            while (properties[finalName]) {
                finalName = `${propName}_${++counter}`
            }

            properties[finalName] = {
                type: propName === 'count' ? 'number' : 'string',
                description: `Arguments for ${cmd.name} (${rawToken})`
            }

            // Treat <required> as strictly required, or require first parameter if not explicitly marked optional
            if (token.startsWith('<') || (idx === 0 && !usage.includes('(opsional)'))) {
                required.push(finalName)
            }
        })

        return {
            type: 'object',
            properties,
            required
        }
    }

    // Case 3: Zero-parameter command (ping, uptime, etc.)
    return {
        type: 'object',
        properties: {},
        required: []
    }
}

/**
 * Dynamically compiles OpenAI-compatible tool specifications for registered commands.
 * Filters commands according to role ('user'|'admin'|'owner') and optional category.
 */
export function getToolSchemas({ role = 'user', category = null } = {}) {
    const cacheKey = `${role}:${category || 'all'}`
    if (schemaCache.has(cacheKey)) {
        return schemaCache.get(cacheKey)
    }

    const schemas = []
    const targetCategory = category ? normalizeCategory(category) : null

    for (const cmd of commandsByName.values()) {
        if (cmd.enabled === false) continue
        if (!isAllowedForRole(cmd, role)) continue
        if (targetCategory && cmd.category !== targetCategory) continue

        schemas.push({
            type: 'function',
            function: {
                name: cmd.name,
                description: cmd.description,
                parameters: compileParameters(cmd)
            }
        })
    }

    schemaCache.set(cacheKey, schemas)
    return schemas
}

// ─────────────────────────────────────────────
// DYNAMIC PROMPT DEFINITIONS GENERATOR
// ─────────────────────────────────────────────

/**
 * Formats clean, concise tool definitions for prompt injection into Hermes Agent and AI system prompts.
 * Respects role boundaries and groups tools by canonical category.
 */
export function generatePromptToolDefinitions({ role = 'user', category = null, compact = false } = {}) {
    const cacheKey = `${role}:${category || 'all'}:${compact ? 'compact' : 'detailed'}`
    if (promptCache.has(cacheKey)) {
        return promptCache.get(cacheKey)
    }

    const targetCategory = category ? normalizeCategory(category) : null
    const targetCommands = []

    for (const cmd of commandsByName.values()) {
        if (cmd.enabled === false) continue
        if (!isAllowedForRole(cmd, role)) continue
        if (targetCategory && cmd.category !== targetCategory) continue
        targetCommands.push(cmd)
    }

    // Group commands by canonical category
    const grouped = new Map()
    for (const cat of CANONICAL_CATEGORIES) {
        grouped.set(cat, [])
    }
    for (const cmd of targetCommands) {
        const cat = cmd.category || 'general'
        if (!grouped.has(cat)) grouped.set(cat, [])
        grouped.get(cat).push(cmd)
    }

    const lines = []
    lines.push('### 🛠️ ACTIVE AGENT SKILLS & TOOLS (Available Tools):')
    lines.push('To execute a tool, respond ONLY with a raw JSON object: {"executeCommand": true, "command": "<tool_name>", "args": [...]}.')
    lines.push('')

    for (const [catName, cmdList] of grouped.entries()) {
        if (!cmdList.length) continue
        cmdList.sort((a, b) => a.name.localeCompare(b.name))

        lines.push(`#### [${catName.toUpperCase()}]`)
        for (const cmd of cmdList) {
            const aliasStr = cmd.aliases?.length ? ` (aliases: ${cmd.aliases.map(a => `\`${a}\``).join(', ')})` : ''
            const desc = cmd.description || 'No description available.'
            const usage = cmd.usage || `.${cmd.name}`

            if (compact) {
                lines.push(`- **${cmd.name}**${aliasStr}: ${desc} | Usage: \`${usage}\``)
            } else {
                lines.push(`- **${cmd.name}**${aliasStr}:`)
                lines.push(`  - Description: ${desc}`)
                lines.push(`  - Usage: \`${usage}\``)
                if (cmd.example) {
                    lines.push(`  - Example: \`${cmd.example.split('\n')[0]}\``)
                }
                const compiled = compileParameters(cmd)
                if (compiled.properties && Object.keys(compiled.properties).length > 0) {
                    const paramKeys = Object.entries(compiled.properties)
                        .map(([k, v]) => `"${k}": "<${v.type}>"`)
                        .join(', ')
                    lines.push(`  - Params: { ${paramKeys} }`)
                }
            }
        }
        lines.push('')
    }

    const output = lines.join('\n').trim()
    promptCache.set(cacheKey, output)
    return output
}
