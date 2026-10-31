/**
 * tests/e2e/tier1_features.test.js
 * 
 * Tier 1: Feature Coverage & Happy Paths
 * Tests core capabilities: command loading, registry indexing, schema compilation,
 * prompt generation, and dispatcher execution under nominal conditions.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { createMockSocket } from './harness/mockSocket.js'
import { createMockContext, OWNER_JID, TEST_USER_JID } from './harness/mockContext.js'
import { ensureCommandsLoaded, getUnifiedRegistry, getUnifiedDispatcher } from './harness/testHelper.js'

describe('Tier 1: Feature Coverage (Happy Path)', () => {
    let registry
    let dispatcher
    let commandsMap

    before(async () => {
        commandsMap = await ensureCommandsLoaded()
        registry = await getUnifiedRegistry()
        dispatcher = await getUnifiedDispatcher()
    })

    test('1.1 Command Loader Census: All commands and aliases loaded into memory', async () => {
        assert.ok(commandsMap.size >= 102, `Expected at least 102 commands, found ${commandsMap.size}`)
        
        // Count unique command objects
        const uniqueCommands = new Set([...commandsMap.values()])
        assert.ok(uniqueCommands.size >= 100, `Expected at least 100 unique command modules, found ${uniqueCommands.size}`)

        // Verify each unique command exports mandatory properties
        for (const cmd of uniqueCommands) {
            assert.ok(cmd.name, `Command missing name property: ${JSON.stringify(cmd)}`)
            assert.equal(typeof cmd.execute, 'function', `Command ${cmd.name} execute must be a function`)
            assert.ok(cmd.category, `Command ${cmd.name} missing category`)
        }
    })

    test('1.2 Unified Registry Lookup: Canonical name and alias resolution', async () => {
        const pingCmd = registry.getCommand('ping')
        assert.ok(pingCmd, 'Failed to resolve canonical command "ping"')
        assert.equal(pingCmd.name, 'ping')

        // Resolve via alias 'p'
        const aliasCmd = registry.getCommand('p')
        assert.ok(aliasCmd, 'Failed to resolve command via alias "p"')
        assert.equal(aliasCmd.name, 'ping')

        // Resolve case-insensitively
        const upperCmd = registry.getCommand('PING')
        assert.ok(upperCmd, 'Failed to resolve uppercase "PING"')
        assert.equal(upperCmd.name, 'ping')
    })

    test('1.3 Category Taxonomy: getCommandsByCategory returns valid subset', async () => {
        const generalCmds = registry.getCommandsByCategory('general')
        assert.ok(Array.isArray(generalCmds), 'getCommandsByCategory should return an array')
        assert.ok(generalCmds.length > 0, 'General category should have at least 1 command')
        
        const names = generalCmds.map(c => c.name)
        assert.ok(names.includes('ping') || names.includes('help'), 'General category should contain ping or help')
    })

    test('1.4 Dynamic Tool Schema Generation: Returns valid AI function calling format', async () => {
        const schemas = registry.getToolSchemas({ role: 'user' })
        assert.ok(Array.isArray(schemas), 'Schemas should be an array')
        assert.ok(schemas.length > 0, 'Schemas should not be empty')

        // Verify JSON Schema structure
        const first = schemas[0]
        assert.equal(first.type, 'function', 'Schema type must be function')
        assert.ok(first.function, 'Schema must contain function object')
        assert.ok(typeof first.function.name === 'string', 'function.name must be string')
        assert.ok(typeof first.function.description === 'string', 'function.description must be string')
        assert.ok(first.function.parameters, 'function.parameters must be defined')
    })

    test('1.5 Dynamic System Prompt Tool Definitions: Generates structured markdown', async () => {
        const promptDefs = registry.generatePromptToolDefinitions({ role: 'user' })
        assert.ok(typeof promptDefs === 'string', 'Prompt definitions must be a string')
        assert.ok(promptDefs.includes('Available Tools'), 'Prompt definitions must have header')
        assert.ok(promptDefs.includes('ping'), 'Prompt definitions must describe ping command')
    })

    test('1.6 Direct Command Execution: Ping responds with Pong!', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({ sock, body: '.ping' })
        const pingCmd = registry.getCommand('ping')

        await pingCmd.execute(ctx)

        const sent = sock.getLastMessage()
        assert.ok(sent, 'Socket should have received a message')
        assert.ok(sent.content.text.includes('Pong!'), `Expected "Pong!", got: ${sent.content.text}`)
    })

    test('1.7 Direct Command Execution: Help menu renders categories and header', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({ sock, body: '.help' })
        const helpCmd = registry.getCommand('help')

        await helpCmd.execute(ctx)

        const sent = sock.getLastMessage()
        assert.ok(sent, 'Socket should have received a message')
        assert.ok(sent.content.text.includes('RONN BOT') || sent.content.text.includes('DAFTAR PERINTAH') || sent.content.text.includes('Runtime'), 
            `Unexpected help output: ${sent.content.text}`)
    })

    test('1.8 Dispatcher Execution: Happy path for ping returns success and output', async () => {
        const sock = createMockSocket()
        const ctx = createMockContext({ sock, body: '.ping' })

        const result = await dispatcher.dispatchCommand('ping', [], ctx, { source: 'manual', captureOutput: true })

        assert.equal(result.success, true, `Dispatch failed: ${result.reason} - ${result.message}`)
        assert.ok(result.output.includes('Pong!'), `Output did not contain "Pong!": ${result.output}`)
        assert.equal(sock.getLastMessage().content.text, 'Pong!')
    })

    test('1.9 Dispatcher Execution: Resolves aliases seamlessly', async () => {
        const sock = createMockSocket()
        // Use unique sender to ensure test isolation from test 1.8's cooldown tracking
        const ctx = createMockContext({ sock, sender: '6287711223344@s.whatsapp.net', body: '!p' })

        const result = await dispatcher.dispatchCommand('p', [], ctx, { source: 'manual' })

        assert.equal(result.success, true, `Alias dispatch failed: ${result.reason}`)
        assert.ok(sock.getLastMessage().content.text.includes('Pong!'))
    })
})
