/**
 * tests/e2e/tier4_scenarios.test.js
 * 
 * Tier 4: Real-World Scenarios & Message Lifecycle Simulation
 * Tests complete end-to-end message lifecycles: Baileys wrapper unwrapping (ephemeral, view-once),
 * interactive button and list responses, AI reasoning loop context bridging and output capture,
 * and graceful error containment.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { createMockSocket } from './harness/mockSocket.js'
import { createMockContext, OWNER_JID } from './harness/mockContext.js'
import { ensureCommandsLoaded, getUnifiedRegistry, getUnifiedDispatcher } from './harness/testHelper.js'
import { unwrapMessage } from '../../src/utils/message.js'
import { handleIncomingMessage } from '../../src/handlers/message.js'

describe('Tier 4: Real-World Scenarios & Full Lifecycle Simulation', () => {
    let registry
    let dispatcher
    let commandsMap

    before(async () => {
        commandsMap = await ensureCommandsLoaded()
        registry = await getUnifiedRegistry()
        dispatcher = await getUnifiedDispatcher()
    })

    test('4.1 Ephemeral Message Lifecycle: Deeply nested ephemeralMessage unwrapped and executed', async () => {
        const sock = createMockSocket()
        const sender = '6289944000001@s.whatsapp.net'
        const nestedMsg = {
            key: {
                remoteJid: sender,
                fromMe: false,
                id: 'EPH_MSG_001'
            },
            message: {
                ephemeralMessage: {
                    message: {
                        conversation: '.ping'
                    }
                }
            }
        }

        // Test unwrapMessage utility
        const unwrapped = unwrapMessage(nestedMsg.message)
        assert.ok(unwrapped.conversation, 'Ephemeral message should unwrap to conversation')
        assert.equal(unwrapped.conversation, '.ping')

        // Process through full message handler
        await handleIncomingMessage(sock, { messages: [nestedMsg] })

        const lastMsg = sock.getLastMessage(sender) || sock.getLastMessage()
        assert.ok(lastMsg, 'Handler should have replied to ephemeral message')
        assert.ok(lastMsg.content.text.includes('Pong!'))
    })

    test('4.2 View-Once Message Lifecycle: viewOnceMessage with caption unwrapped correctly', async () => {
        const sock = createMockSocket()
        const sender = '6289944000002@s.whatsapp.net'
        const viewOnceMsg = {
            key: {
                remoteJid: sender,
                fromMe: false,
                id: 'VO_MSG_002'
            },
            message: {
                viewOnceMessage: {
                    message: {
                        imageMessage: {
                            caption: '.ping',
                            mimetype: 'image/jpeg'
                        }
                    }
                }
            }
        }

        const unwrapped = unwrapMessage(viewOnceMsg.message)
        assert.ok(unwrapped.imageMessage, 'Should unwrap to imageMessage')
        assert.equal(unwrapped.imageMessage.caption, '.ping')

        await handleIncomingMessage(sock, { messages: [viewOnceMsg] })

        const lastMsg = sock.getLastMessage(sender)
        assert.ok(lastMsg, 'Handler should have replied to view-once command')
        assert.ok(lastMsg.content.text.includes('Pong!'))
    })

    test('4.3 Interactive Native Flow / Button Response: Parses button ID and executes command', async () => {
        const sock = createMockSocket()
        const sender = '6289944000003@s.whatsapp.net'
        const buttonMsg = {
            key: {
                remoteJid: sender,
                fromMe: false,
                id: 'BTN_MSG_003'
            },
            message: {
                buttonsResponseMessage: {
                    selectedButtonId: '.ping'
                }
            }
        }

        await handleIncomingMessage(sock, { messages: [buttonMsg] })

        const lastMsg = sock.getLastMessage()
        assert.ok(lastMsg, 'Button response should trigger command execution')
        assert.ok(lastMsg.content.text.includes('Pong!'))
    })

    test('4.4 Interactive Single Select List Reply: Parses row ID and executes command', async () => {
        const sock = createMockSocket()
        const sender = '6289944000004@s.whatsapp.net'
        const listReplyMsg = {
            key: {
                remoteJid: sender,
                fromMe: false,
                id: 'LIST_MSG_004'
            },
            message: {
                listResponseMessage: {
                    singleSelectReply: {
                        selectedRowId: '.ping'
                    }
                }
            }
        }

        await handleIncomingMessage(sock, { messages: [listReplyMsg] })

        const lastMsg = sock.getLastMessage()
        assert.ok(lastMsg, 'List reply should trigger command execution')
        assert.ok(lastMsg.content.text.includes('Pong!'))
    })

    test('4.5 AI Context Bridge & Output Interception: Captures command reply for reasoning feedback', async () => {
        const sock = createMockSocket()
        const sender = '6289944000005@s.whatsapp.net'
        const ctx = createMockContext({
            sock,
            sender,
            body: 'Run ping'
        })

        // Execute via dispatcher with captureOutput: true
        const result = await dispatcher.dispatchCommand('ping', [], ctx, {
            source: 'ai',
            captureOutput: true
        })

        assert.equal(result.success, true)
        assert.ok(typeof result.output === 'string', 'Output must be string')
        assert.ok(result.output.includes('Pong!'), `Captured output should contain Pong!, got: ${result.output}`)
    })

    test('4.6 Exception Containment: Unhandled runtime errors in commands are caught gracefully', async () => {
        const sock = createMockSocket()
        const sender = '6289944000006@s.whatsapp.net'
        const ctx = createMockContext({ sock, sender, body: '.failing_command' })

        // Create a temporary faulty command
        const faultyCmd = {
            name: 'faulty_test_command',
            category: 'general',
            description: 'Intentionally faulty test command',
            execute: async () => {
                throw new Error('Simulated upstream external API failure')
            }
        }
        commandsMap.set(faultyCmd.name, faultyCmd)

        try {
            const result = await dispatcher.dispatchCommand('faulty_test_command', [], ctx)

            assert.equal(result.success, false)
            assert.equal(result.reason, 'ERROR')
            assert.ok(result.error instanceof Error)
            assert.equal(result.error.message, 'Simulated upstream external API failure')
        } finally {
            commandsMap.delete(faultyCmd.name)
        }
    })

    test('4.7 Drop Self-Sent Messages: Messages from bot itself are ignored without loops', async () => {
        const sock = createMockSocket()
        const selfMsg = {
            key: {
                remoteJid: '6289944000007@s.whatsapp.net',
                fromMe: true, // Sent from bot
                id: 'SELF_MSG_005'
            },
            message: {
                conversation: '.ping'
            }
        }

        await handleIncomingMessage(sock, { messages: [selfMsg] })

        // No reply should be generated for self-sent messages
        assert.equal(sock.getSentMessages().length, 0, 'Bot should ignore its own messages')
    })
})
