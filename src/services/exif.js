import crypto from 'crypto'
import webpmux from 'node-webpmux'

export async function addExif(webpBuffer, packname = 'ronnBot by ronnanakibu', author = 'https://github.com/ronnanakibu') {
    const json = {
        'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': packname,
        'sticker-pack-publisher': author,
        emojis: ['🤖', '🔥', '😂']
    }

    let length = JSON.stringify(json).length
    const f = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00])
    const code = [0x00, 0x00, 0x16, 0x00, 0x00, 0x00]

    if (length > 256) {
        length = length - 256
        code.unshift(0x01)
    } else {
        code.unshift(0x00)
    }

    const fff = Buffer.from(code)
    const ffff = Buffer.from(JSON.stringify(json))

    let lengthHex = length.toString(16)
    if (lengthHex.length < 2) lengthHex = '0' + lengthHex
    const ff = Buffer.from(lengthHex, 'hex')

    const exifBytes = Buffer.concat([f, ff, fff, ffff])

    const img = new webpmux.Image()
    await img.load(webpBuffer)

    img.exif = exifBytes
    return await img.save(null) // Return as buffer
}
