import crypto from 'crypto'
import webpmux from 'node-webpmux'

export async function addExif(webpBuffer, packname = 'ronnBot by ronnanakibu', author = 'https://github.com/ronnanakibu') {
    const json = {
        'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': packname,
        'sticker-pack-publisher': author,
        emojis: ['🤖', '🔥', '😂']
    }
    const jsonStr = JSON.stringify(json)
    const jsonBuffer = Buffer.from(jsonStr, 'utf8')
    const exifAttr = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ])
    exifAttr.writeUInt32LE(jsonBuffer.length, 14)
    const exifBytes = Buffer.concat([exifAttr, jsonBuffer])

    const img = new webpmux.Image()
    await img.load(webpBuffer)
    img.exif = exifBytes
    return await img.save(null) // Return as buffer
}
