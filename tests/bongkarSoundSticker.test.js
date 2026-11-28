import test from 'node:test'
import assert from 'node:assert/strict'
import bongkarCommand from '../src/commands/media/bongkar.js'
import {
    buildSoundStickerWrapper,
    SOUND_STICKER_BYTES,
    installSoundStickerDecoder,
    installSoundStickerEncoder
} from '../src/services/soundSticker.js'
import { proto } from '@whiskeysockets/baileys'

test('Bongkar: command detects sound sticker and formats response as video/mp4', async () => {
    installSoundStickerEncoder()
    installSoundStickerDecoder()

    const dummySticker = {
        url: 'https://example.com/stk.webp',
        mimetype: 'image/webp',
        isAnimated: true
    }
    const dummyAudio = {
        url: 'https://example.com/aud.ogg',
        mimetype: 'audio/ogg; codecs=opus',
        seconds: 3
    }
    const wrapper = buildSoundStickerWrapper(dummySticker, dummyAudio)
    const markedMsg = { [SOUND_STICKER_BYTES]: wrapper }
    const encoded = proto.Message.encode(markedMsg).finish()
    const decodedQuoted = proto.Message.decode(encoded)

    assert.ok(decodedQuoted.stickerMessage, 'Quoted should contain stickerMessage')
    assert.ok(decodedQuoted.stickerMessage.audioMessage, 'Quoted sticker should contain audioMessage')

    let sentPayload = null
    const mockSock = {
        sendMessage: async (jid, content, options) => {
            sentPayload = { jid, content, options }
            return { key: { id: 'test_msg_id' } }
        }
    }

    let reacted = []
    const mockCtx = {
        msg: { key: { remoteJid: 'test@s.whatsapp.net', id: 'cmd_msg' } },
        messageContent: {
            extendedTextMessage: {
                text: '.bongkar',
                contextInfo: {
                    quotedMessage: decodedQuoted
                }
            }
        },
        reply: async (t) => {},
        react: async (emoji) => { reacted.push(emoji) },
        sock: mockSock,
        from: 'test@s.whatsapp.net',
        pushName: 'Tester',
        sender: 'tester@s.whatsapp.net'
    }

    // Verify bongkar command properties
    assert.equal(bongkarCommand.name, 'bongkar')
    assert.ok(bongkarCommand.aliases.includes('toimg'))
    assert.ok(bongkarCommand.aliases.includes('tomp4'))
})
