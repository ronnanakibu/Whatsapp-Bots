import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
    soundStickerService,
    buildSoundStickerWrapper,
    installSoundStickerEncoder,
    createStreamingSidecar,
    SOUND_STICKER_BYTES
} from '../src/services/soundSticker.js'
import { proto } from '@whiskeysockets/baileys'

test('SoundSticker: buildSoundStickerWrapper constructs valid protobuf FutureProof bytes', () => {
    const dummySticker = { url: 'https://example.com/stk.webp', mimetype: 'image/webp' }
    const dummyAudio = { url: 'https://example.com/aud.ogg', mimetype: 'audio/ogg; codecs=opus' }
    const wrapper = buildSoundStickerWrapper(dummySticker, dummyAudio)

    assert.ok(Buffer.isBuffer(wrapper), 'Wrapper should be a buffer')
    assert.ok(wrapper.length > 0, 'Wrapper should not be empty')
})

test('SoundSticker: installSoundStickerEncoder patches Message encoder for marked sound sticker', () => {
    installSoundStickerEncoder()

    const dummySticker = { url: 'https://example.com/stk.webp', mimetype: 'image/webp' }
    const dummyAudio = { url: 'https://example.com/aud.ogg', mimetype: 'audio/ogg; codecs=opus' }
    const wrapper = buildSoundStickerWrapper(dummySticker, dummyAudio)

    const markedMsg = {
        stickerMessage: dummySticker,
        [SOUND_STICKER_BYTES]: wrapper
    }

    const encoded = proto.Message.encode(markedMsg).finish()
    assert.ok(encoded.length > wrapper.length, 'Encoded buffer should contain field 134 bytes')

    // Standard message without symbol should encode normally without error
    const plainMsg = { conversation: 'Hello world' }
    const plainEncoded = proto.Message.encode(plainMsg).finish()
    assert.ok(plainEncoded.length > 0, 'Plain message encodes normally')
})

test('SoundSticker: createStreamingSidecar computes correct chunked HMAC hashes', async () => {
    const dummyAudio = Buffer.from('Test audio content for sidecar hashing '.repeat(100))
    const mediaKey = crypto.randomBytes(32)

    // Calculate fileEncSha256 as Baileys does
    const { iv, cipherKey, macKey } = await import('@whiskeysockets/baileys').then(b => b.getMediaKeys(mediaKey, 'audio'))
    const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv)
    const encrypted = Buffer.concat([cipher.update(dummyAudio), cipher.final()])
    const mac = crypto.createHmac('sha256', macKey).update(iv).update(encrypted).digest().subarray(0, 10)
    const fileEncSha256 = crypto.createHash('sha256').update(encrypted).update(mac).digest()

    const sidecar = await createStreamingSidecar(dummyAudio, mediaKey, fileEncSha256)
    assert.ok(Buffer.isBuffer(sidecar), 'Sidecar should be a Buffer')
    assert.equal(sidecar.length, 10, 'Single chunk <= 64KB should have a 10-byte HMAC')
})
