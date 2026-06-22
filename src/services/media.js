// src/services/media.js
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { exec } from 'child_process'
import util from 'util'
import crypto from 'crypto'
import { logger } from '../utils/logger.js'
import { addExif } from './exif.js'

const execPromise = util.promisify(exec)

const EMOJI_CACHE_DIR = path.resolve('./storage/media/emoji-cache')
const NOTO_BASE = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128'

function emojiToCodepoint(emoji) {
    const codepoints = []
    const chars = [...emoji]
    for (let i = 0; i < chars.length; i++) {
        const cp = chars[i].codePointAt(0)
        if (cp === 0xFE0F) continue
        codepoints.push(cp.toString(16))
    }
    return 'emoji_u' + codepoints.join('_')
}

async function fetchEmojiPng(emoji) {
    if (!fs.existsSync(EMOJI_CACHE_DIR)) fs.mkdirSync(EMOJI_CACHE_DIR, { recursive: true })
    const cp = emojiToCodepoint(emoji)
    const cachePath = path.join(EMOJI_CACHE_DIR, `${cp}.png`)

    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 100) return cachePath
    const url = `${NOTO_BASE}/${cp}.png`

    return new Promise((resolve) => {
        const file = fs.createWriteStream(cachePath)
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close()
                https.get(res.headers.location, (res2) => {
                    res2.pipe(file)
                    file.on('finish', () => { file.close(); resolve(cachePath) })
                }).on('error', () => { fs.unlink(cachePath, () => { }); resolve(null) })
                return
            }
            if (res.statusCode !== 200) {
                file.close()
                fs.unlink(cachePath, () => { })
                resolve(null)
                return
            }
            res.pipe(file)
            file.on('finish', () => { file.close(); resolve(cachePath) })
        }).on('error', () => {
            fs.unlink(cachePath, () => { })
            resolve(null)
        })
    })
}

function pngToDataUri(filePath) {
    const buf = fs.readFileSync(filePath)
    return `data:image/png;base64,${buf.toString('base64')}`
}

const EMOJI_REGEX = /\p{Emoji_Presentation}\p{Emoji_Modifier_Base}?\p{Emoji_Modifier}?(\u200D\p{Emoji_Presentation}\p{Emoji_Modifier_Base}?\p{Emoji_Modifier}?)*\uFE0F?/gu;

function detectEmojis(text) {
    const matches = [...text.matchAll(EMOJI_REGEX)]
    return [...new Set(matches.map(m => m[0]))]
}

async function prepareEmojiMap(text) {
    const emojis = detectEmojis(text)
    const map = new Map()
    await Promise.all(emojis.map(async (emoji) => {
        try {
            const filePath = await fetchEmojiPng(emoji)
            if (filePath) map.set(emoji, pngToDataUri(filePath))
        } catch (e) { }
    }))
    return map
}

export class MediaService {
    constructor() {
        this.allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp']
        this.maxSizeBytes = 5 * 1024 * 1024 // 5 MB
        this.storageDir = path.resolve(process.cwd(), 'storage', 'uploads')
        this.ensureStorageDirExists()
        this.#initFontconfig()
    }

    ensureStorageDirExists() {
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true })
        }
    }

    #initFontconfig() {
        try {
            const configDir = path.resolve('./storage/database')
            const fontDir = path.resolve('./src/assets/fonts')
            const cacheDir = path.resolve('./storage/database/fontcache')
            const configFile = path.join(configDir, 'fonts.conf')

            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
            if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true })
            if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })

            const config = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
    <dir>${fontDir}</dir>
    <dir>/usr/share/fonts</dir>
    <dir>/usr/local/share/fonts</dir>
    <cachedir>${cacheDir}</cachedir>
</fontconfig>`

            fs.writeFileSync(configFile, config, 'utf8')
            process.env.FONTCONFIG_FILE = configFile
            console.log(`⚙️ [MediaService] Fontconfig ready → ${fontDir}`)
        } catch (e) {
            console.error('❌ [MediaService] Fontconfig init gagal:', e.message)
        }
    }

    #wrapText(text, maxCharsPerLine = 11) {
        const spaced = text.replace(EMOJI_REGEX, (m) => ` ${m} `)
        const tokens = spaced.trim().split(/\s+/).filter(Boolean)
        const visualLen = str => [...str].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2000 ? 2 : 1), 0)

        let lines = []
        let currentLine = ''

        tokens.forEach(word => {
            const wLen = visualLen(word)
            const lineLen = visualLen(currentLine)

            if (wLen > maxCharsPerLine) {
                if (currentLine.trim()) {
                    lines.push(currentLine.trim())
                    currentLine = ''
                }
                let tempWord = word
                while (visualLen(tempWord) > maxCharsPerLine) {
                    let cutIndex = 0
                    let currentCutLen = 0
                    for (let i = 0; i < tempWord.length; i++) {
                        const cp = tempWord.codePointAt(i)
                        const charLen = cp > 0x2000 ? 2 : 1
                        if (currentCutLen + charLen > maxCharsPerLine) break
                        currentCutLen += charLen
                        cutIndex = i + 1
                    }
                    if (cutIndex === 0) cutIndex = 1
                    lines.push(tempWord.substring(0, cutIndex))
                    tempWord = tempWord.substring(cutIndex)
                }
                if (tempWord) currentLine = tempWord + ' '
                return
            }
            if (lineLen + wLen > maxCharsPerLine) {
                if (currentLine.trim()) lines.push(currentLine.trim())
                currentLine = word + ' '
            } else {
                currentLine += word + ' '
            }
        })
        if (currentLine.trim()) lines.push(currentLine.trim())
        return lines
    }

    #escapeXml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .trim()
    }

    #processTextAdaptive(text, isBottom = false) {
        if (!text) return { lines: [], fontSize: 80, startY: 0, lineSpacing: 0 }

        const words = text.trim().split(/\s+/)
        let lines = []

        if (text.length > 15 && words.length > 1) {
            const mid = Math.ceil(words.length / 2)
            lines.push(words.slice(0, mid).join(' '))
            lines.push(words.slice(mid).join(' '))
        } else {
            lines.push(text)
        }

        const maxLineLength = Math.max(...lines.map(l => l.length))
        let fontSize = Math.floor(490 / (maxLineLength * 0.55))
        fontSize = Math.max(35, Math.min(85, fontSize))

        const lineSpacing = fontSize * 1.05
        const startY = isBottom
            ? 485 - ((lines.length - 1) * lineSpacing)
            : fontSize + 20

        return { lines, fontSize, startY, lineSpacing }
    }

    #renderLine(line, y, fontSize, opts) {
        const {
            x = 25,
            textAnchor = 'start',
            fontFamily = "'Arial Narrow', Arial, sans-serif",
            fontWeight = 'normal',
            fill = '#000000',
            stroke = null,
            strokeWidth = '0',
            emojiMap = new Map(),
            letterSpacing = '-2px'
        } = opts

        const spaced = line.replace(EMOJI_REGEX, (m) => ` ${m} `)
        const tokens = spaced.trim().split(/\s+/).filter(Boolean)

        let elements = ''
        const strokeAttr = stroke ? `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke fill"` : ''

        if (textAnchor === 'middle') {
            const textOnly = tokens.filter(t => detectEmojis(t).length === 0).join(' ').trim()
            const emojisInLine = tokens.filter(t => detectEmojis(t).length > 0)
            const safeText = this.#escapeXml(textOnly)

            elements += `
            <text x="${x}" y="${y}"
                text-anchor="middle"
                font-family="${fontFamily}"
                font-weight="${fontWeight}"
                font-size="${fontSize}px"
                fill="${fill}"
                ${strokeAttr}>${safeText}</text>\n`

            const emojiSize = fontSize * 1.05
            const estTextWidth = [...safeText].length * fontSize * 0.52
            let emojiX = x + (estTextWidth / 2) + 10
            const emojiY = y - emojiSize * 0.84

            emojisInLine.forEach(emoji => {
                const dataUri = emojiMap.get(emoji.trim()) ?? emojiMap.get(detectEmojis(emoji)[0])
                if (dataUri) {
                    elements += `<image href="${dataUri}" x="${emojiX}" y="${emojiY}" width="${emojiSize}" height="${emojiSize}"/>\n`
                    emojiX += emojiSize * 1.05
                }
            })
            return elements
        }

        const justifyWidth = 462
        const emojiSize = fontSize * 1.05

        if (tokens.length === 1) {
            const token = tokens[0]
            const isEmoji = detectEmojis(token).length > 0
            if (isEmoji) {
                const dataUri = emojiMap.get(token.trim()) ?? emojiMap.get(detectEmojis(token)[0])
                if (dataUri) elements += `<image href="${dataUri}" x="${x}" y="${y - emojiSize * 0.84}" width="${emojiSize}" height="${emojiSize}"/>\n`
            } else {
                elements += `<text x="${x}" y="${y}" text-anchor="start" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fontSize}px" fill="${fill}" letter-spacing="${letterSpacing}">${this.#escapeXml(token)}</text>\n`
            }
        } else {
            const tokenWidths = tokens.map(t => {
                if (detectEmojis(t).length > 0) return emojiSize
                return [...t].length * fontSize * 0.44
            })

            const totalContentWidth = tokenWidths.reduce((a, b) => a + b, 0)
            let gap = (justifyWidth - totalContentWidth) / (tokens.length - 1)

            const maxGap = fontSize * 0.22
            if (gap > maxGap) gap = maxGap
            if (gap < 0) gap = fontSize * 0.15

            let currentX = x
            tokens.forEach((token, index) => {
                const isEmoji = detectEmojis(token).length > 0
                if (isEmoji) {
                    const dataUri = emojiMap.get(token.trim()) ?? emojiMap.get(detectEmojis(token)[0])
                    if (dataUri) elements += `<image href="${dataUri}" x="${currentX}" y="${y - emojiSize * 0.84}" width="${emojiSize}" height="${emojiSize}"/>\n`
                } else {
                    elements += `<text x="${currentX}" y="${y}" text-anchor="start" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fontSize}px" fill="${fill}" letter-spacing="${letterSpacing}">${this.#escapeXml(token)}</text>\n`
                }
                currentX += tokenWidths[index] + gap
            })
        }

        return elements
    }

    async #executeRembg(buffer) {
        const tmpDir = path.resolve('./storage/media/tmp')
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

        const id = crypto.randomBytes(4).toString('hex')
        const inputPath = path.join(tmpDir, `${id}_rb_in.png`)
        const outputPath = path.join(tmpDir, `${id}_rb_out.png`)

        fs.writeFileSync(inputPath, buffer)
        try {
            const pythonCmd = process.env.PYTHON_CMD || 'python3'
            await execPromise(`"${pythonCmd}" -m rembg i "${inputPath}" "${outputPath}"`)
            return fs.readFileSync(outputPath)
        } catch (err) {
            logger.warn('⚠️ [Rembg Local Failed, falling back to Remote API]: ' + err.message)
            try {
                const { Client } = await import('@gradio/client')
                const app = await Client.connect('KenjieDec/RemBG')
                const blob = new Blob([buffer], { type: 'image/png' })
                
                const result = await app.predict('/inference', [
                    blob,
                    'u2net',
                    0,
                    0
                ])
                
                const outImage = result.data[0]
                if (!outImage || !outImage.url) {
                    throw new Error('Gagal mendapatkan URL gambar transparan dari server API.')
                }
                
                const axios = (await import('axios')).default
                const response = await axios.get(outImage.url, { responseType: 'arraybuffer' })
                return Buffer.from(response.data)
            } catch (remoteErr) {
                logger.error(remoteErr, '❌ [Rembg Remote Error]')
                throw new Error('Gagal memproses penghapusan latar belakang (lokal & remote).')
            }
        } finally {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        }
    }

    /**
     * Validate image input parameters. (Used by v2 backend controllers)
     */
    validateImage(metadata) {
        if (!this.allowedMimeTypes.includes(metadata.mimeType)) {
            return {
                isValid: false,
                reason: `Format gambar tidak didukung. Format yang diizinkan: ${this.allowedMimeTypes.join(', ')}`,
            }
        }

        if (metadata.sizeBytes > this.maxSizeBytes) {
            return {
                isValid: false,
                reason: `Ukuran berkas melebihi batas maksimum 5MB.`,
            }
        }

        return { isValid: true }
    }

    /**
     * Compresses image to optimize resource utilization (placeholder logic for future dependency plugins).
     */
    async compressImage(buffer) {
        return buffer
    }

    /**
     * Saves image buffer and returns the accessible asset path/url.
     */
    async saveAvatar(userId, buffer, filename) {
        const ext = path.extname(filename) || '.png'
        const relativePath = path.join('avatars', `${userId}_${Date.now()}${ext}`)
        const absolutePath = path.join(this.storageDir, relativePath)

        // Ensure avatars subdirectory exists
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

        const processedBuffer = await this.compressImage(buffer)
        fs.writeFileSync(absolutePath, processedBuffer)

        return `/uploads/${relativePath.replace(/\\/g, '/')}`
    }

    /**
     * Saves banner buffer and returns the accessible asset path/url.
     */
    async saveBanner(userId, buffer, filename) {
        const ext = path.extname(filename) || '.png'
        const relativePath = path.join('banners', `${userId}_${Date.now()}${ext}`)
        const absolutePath = path.join(this.storageDir, relativePath)

        // Ensure banners subdirectory exists
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

        const processedBuffer = await this.compressImage(buffer)
        fs.writeFileSync(absolutePath, processedBuffer)

        return `/uploads/${relativePath.replace(/\\/g, '/')}`
    }

    /**
     * Deletes a local media asset file.
     */
    deleteMedia(relativeUrlPath) {
        if (!relativeUrlPath.startsWith('/uploads/')) return false

        const relativePath = relativeUrlPath.replace('/uploads/', '')
        const absolutePath = path.join(this.storageDir, relativePath)

        try {
            if (fs.existsSync(absolutePath)) {
                fs.unlinkSync(absolutePath)
                return true
            }
        } catch {
            // failed to delete, ignore
        }
        return false
    }

    // ─────────────────────────────────────────────
    // BOT MEDIA PROCESSING API
    // ─────────────────────────────────────────────

    async toQuoteSticker(rawText, lqPercent = 0) {
        try {
            const cleanText = rawText.trim().toLowerCase()
            const lines = this.#wrapText(cleanText, 10)

            const maxVisualLen = Math.max(...lines.map(l => {
                return [...l].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2000 ? 2 : 1), 0)
            }))

            let fontSize = Math.floor(462 / (maxVisualLen * 0.43))
            const maxVerticalFontSize = Math.floor(400 / (lines.length * 1.05))
            fontSize = Math.min(fontSize, maxVerticalFontSize)
            fontSize = Math.max(46, Math.min(180, fontSize))

            const lineSpacing = fontSize * 1.05
            const totalTextHeight = lines.length * lineSpacing
            const startY = (512 - totalTextHeight) / 2 + (fontSize * 0.75)

            const emojiMap = await prepareEmojiMap(cleanText)
            let svgContent = ''

            lines.forEach((line, i) => {
                const y = startY + (i * lineSpacing)
                svgContent += this.#renderLine(line, y, fontSize, {
                    x: 25,
                    textAnchor: 'start',
                    fontFamily: "'Arial Narrow', Arial, sans-serif",
                    fontWeight: 'normal',
                    fill: '#000000',
                    emojiMap,
                    letterSpacing: '-2.5px'
                })
            })

            const svg = Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                ${svgContent}
            </svg>`)

            let rawWebp = await sharp({
                create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
            })
                .composite([{ input: svg, top: 0, left: 0 }])
                .webp({ quality: 95 })
                .toBuffer()

            if (lqPercent > 0) {
                rawWebp = await this.applyLowQualityImage(rawWebp, lqPercent)
            }

            return await addExif(rawWebp)

        } catch (e) {
            logger.error('❌ toQuoteSticker error:', e.message)
            throw new Error('Gagal meracik stiker brat.')
        }
    }

    /**
     * Apply low-quality meme effect — cascaded JPEG compression (image)
     * lqPercent: 0 = original, 100 = maximum burik
     * Progressive compression: encode JPEG at low quality multiple times
     */
    async applyLowQualityImage(buffer, lqPercent) {
        if (!lqPercent || lqPercent <= 0) return buffer
        const pct = Math.min(100, Math.max(1, lqPercent))

        // Map 1-100% → JPEG quality 40→2 (non-linear, perceptually burik)
        // At 0% → quality 40 (subtle), at 100% → quality 2 (mega burik)
        const quality = Math.round(40 - (38 * (pct / 100)))
        // Scale down factor: at 100% we shrink to ~32px then back
        const scaleFactor = Math.max(0.0625, 1 - (pct / 100) * 0.9375) // 1.0 → 0.0625 (64px)
        const downSize  = Math.max(32, Math.round(512 * scaleFactor))

        // Pass 1: downscale + JPEG encode
        let buf = await sharp(buffer)
            .resize(downSize, downSize, { fit: 'fill' })
            .jpeg({ quality, mozjpeg: false })
            .toBuffer()

        // Pass 2 (for extra burik effect): re-encode at even lower quality
        if (pct >= 40) {
            const q2 = Math.max(1, quality - 5)
            buf = await sharp(buf).jpeg({ quality: q2 }).toBuffer()
        }

        // Scale back up to 512 (pixelated because no interpolation resampling)
        buf = await sharp(buf)
            .resize(512, 512, { fit: 'fill', kernel: 'nearest' })
            .webp({ quality: 75 })
            .toBuffer()

        return buf
    }

    /**
     * Apply low-quality effect to video via FFmpeg CRF degradation
     * lqPercent: 0 = original, 100 = maximum burik
     */
    async applyLowQualityVideo(inputPath, outputPath, lqPercent) {
        if (!lqPercent || lqPercent <= 0) return
        const pct = Math.min(100, Math.max(1, lqPercent))
        // CRF range 18 (good) → 51 (worst). At 100% → CRF 51
        const crf = Math.round(18 + (33 * (pct / 100)))
        // Scale down at high % values — pixelate effect
        const scaleSize = Math.max(64, Math.round(512 * (1 - (pct / 100) * 0.875)))
        const vfScale = `scale=${scaleSize}:${scaleSize}:flags=neighbor,scale=512:512:flags=neighbor`
        await execPromise(
            `ffmpeg -y -i "${inputPath}" -vf "${vfScale}" -crf ${crf} -preset ultrafast -an "${outputPath}"`
        )
    }

    async toMemeSticker(bufferImage, topText = '', bottomText = '', noCrop = false, removeBg = false, lqPercent = 0) {
        try {
            if (removeBg) {
                bufferImage = await this.#executeRembg(bufferImage)
            }

            // Apply LQ degradation BEFORE compositing (affect base image only)
            if (lqPercent > 0) {
                bufferImage = await this.applyLowQualityImage(bufferImage, lqPercent)
            }

            const cleanTop = topText.trim().toUpperCase()
            const cleanBottom = bottomText.trim().toUpperCase()

            const topData = this.#processTextAdaptive(cleanTop, false)
            const bottomData = this.#processTextAdaptive(cleanBottom, true)

            const emojiMap = await prepareEmojiMap(cleanTop + ' ' + cleanBottom)
            let svgContent = ''

            topData.lines.forEach((line, i) => {
                const y = topData.startY + (i * topData.lineSpacing)
                svgContent += this.#renderLine(line, y, topData.fontSize, {
                    x: 256,
                    textAnchor: 'middle',
                    fontFamily: "Impact, 'Arial Narrow', sans-serif",
                    fontWeight: 'bold',
                    fill: 'white',
                    stroke: 'black',
                    strokeWidth: topData.fontSize > 60 ? '8' : '5',
                    emojiMap,
                    letterSpacing: '0px'
                })
            })

            bottomData.lines.forEach((line, i) => {
                const y = bottomData.startY + (i * bottomData.lineSpacing)
                svgContent += this.#renderLine(line, y, bottomData.fontSize, {
                    x: 256,
                    textAnchor: 'middle',
                    fontFamily: "Impact, 'Arial Narrow', sans-serif",
                    fontWeight: 'bold',
                    fill: 'white',
                    stroke: 'black',
                    strokeWidth: bottomData.fontSize > 60 ? '8' : '5',
                    emojiMap,
                    letterSpacing: '0px'
                })
            })

            const svg = Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                ${svgContent}
            </svg>`)

            const resizeOptions = noCrop
                ? { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }
                : { fit: 'cover', position: 'center' }

            // LQ applied to base image already — use standard quality for final WebP
            const webpQuality = lqPercent > 0 ? Math.max(30, 85 - Math.round(lqPercent * 0.55)) : 85

            const rawWebp = await sharp(bufferImage)
                .resize(512, 512, resizeOptions)
                .composite([{ input: svg, top: 0, left: 0 }])
                .webp({ quality: webpQuality })
                .toBuffer()

            return await addExif(rawWebp)

        } catch (e) {
            logger.error(e, '❌ toMemeSticker error')
            throw new Error('Gagal memproses stiker meme.')
        }
    }

    async toAnimatedMemeSticker(bufferVideo, topText = '', bottomText = '', noCrop = false, removeBg = false, lqPercent = 0) {
        const tmpDir = path.resolve('./storage/media/tmp')
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

        const id = crypto.randomBytes(4).toString('hex')
        const isWebp = bufferVideo.length > 12 && bufferVideo.slice(8, 12).toString('ascii') === 'WEBP'

        let finalBufferVideo = bufferVideo
        let extension = 'mp4'

        if (isWebp) {
            logger.info('⏳ Converting Animated WebP to GIF for FFmpeg processing...')
            finalBufferVideo = await sharp(bufferVideo, { animated: true }).gif().toBuffer()
            extension = 'gif'
        }

        const inputPath = path.join(tmpDir, `${id}_in.${extension}`)
        const overlayPath = path.join(tmpDir, `${id}_overlay.png`)
        const outputPath = path.join(tmpDir, `${id}_out.webp`)

        const framesInDir = path.join(tmpDir, `${id}_frames_in`)
        const framesOutDir = path.join(tmpDir, `${id}_frames_out`)

        try {
            const cleanTop = topText.trim().toUpperCase()
            const cleanBottom = bottomText.trim().toUpperCase()

            const topData = this.#processTextAdaptive(cleanTop, false)
            const bottomData = this.#processTextAdaptive(cleanBottom, true)

            const emojiMap = await prepareEmojiMap(cleanTop + ' ' + cleanBottom)
            let svgContent = ''

            topData.lines.forEach((line, i) => {
                const y = topData.startY + (i * topData.lineSpacing)
                svgContent += this.#renderLine(line, y, topData.fontSize, {
                    x: 256,
                    textAnchor: 'middle',
                    fontFamily: "Impact, 'Arial Narrow', sans-serif",
                    fontWeight: 'bold',
                    fill: 'white',
                    stroke: 'black',
                    strokeWidth: topData.fontSize > 60 ? '8' : '5',
                    emojiMap,
                    letterSpacing: '0px'
                })
            })

            bottomData.lines.forEach((line, i) => {
                const y = bottomData.startY + (i * bottomData.lineSpacing)
                svgContent += this.#renderLine(line, y, bottomData.fontSize, {
                    x: 256,
                    textAnchor: 'middle',
                    fontFamily: "Impact, 'Arial Narrow', sans-serif",
                    fontWeight: 'bold',
                    fill: 'white',
                    stroke: 'black',
                    strokeWidth: bottomData.fontSize > 60 ? '8' : '5',
                    emojiMap,
                    letterSpacing: '0px'
                })
            })

            const svg = Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                ${svgContent}
            </svg>`)

            const overlayPng = await sharp({
                create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
            })
                .composite([{ input: svg, top: 0, left: 0 }])
                .png()
                .toBuffer()

            fs.writeFileSync(inputPath, finalBufferVideo)
            fs.writeFileSync(overlayPath, overlayPng)

            // Dynamic argument loader untuk FFmpeg input
            let ffmpegInputArgs = `-i "${inputPath}"`

            if (removeBg) {
                logger.info('🔥 [Siksa CPU] Memulai proses pemecahan frame video/gif...')
                fs.mkdirSync(framesInDir, { recursive: true })
                fs.mkdirSync(framesOutDir, { recursive: true })

                // Pecah video asal menjadi sequence gambar PNG stabil di rate 25 FPS
                await execPromise(`ffmpeg -i "${inputPath}" -vf "fps=25" "${path.join(framesInDir, '%04d.png')}"`)

                logger.info('🔥 [Siksa CPU] Menembak modul "rembg p" untuk memproses massal seluruh frame...')
                try {
                    const pythonCmd = process.env.PYTHON_CMD || 'python3'
                    await execPromise(`"${pythonCmd}" -m rembg p "${framesInDir}" "${framesOutDir}"`)
                } catch (err) {
                    logger.warn('⚠️ [Rembg Animated Local Failed, falling back to Remote API]: ' + err.message)
                    try {
                        const { Client } = await import('@gradio/client')
                        const app = await Client.connect('KenjieDec/RemBG')
                        const axios = (await import('axios')).default

                        const files = fs.readdirSync(framesInDir).filter(f => f.endsWith('.png')).sort()
                        
                        // Process in parallel with concurrency limit (e.g. 5 concurrent requests)
                        const concurrencyLimit = 5
                        for (let i = 0; i < files.length; i += concurrencyLimit) {
                            const chunk = files.slice(i, i + concurrencyLimit)
                            await Promise.all(chunk.map(async (file) => {
                                const localFrameIn = path.join(framesInDir, file)
                                const localFrameOut = path.join(framesOutDir, file)
                                
                                const frameBuf = fs.readFileSync(localFrameIn)
                                const blob = new Blob([frameBuf], { type: 'image/png' })
                                
                                const result = await app.predict('/inference', [
                                    blob,
                                    'u2net',
                                    0,
                                    0
                                ])
                                
                                const outImage = result.data[0]
                                if (!outImage || !outImage.url) {
                                    throw new Error(`Gagal memproses frame ${file}`)
                                }
                                
                                const response = await axios.get(outImage.url, { responseType: 'arraybuffer' })
                                fs.writeFileSync(localFrameOut, Buffer.from(response.data))
                            }))
                            logger.info(`Processed frames ${i + 1} to ${Math.min(i + concurrencyLimit, files.length)} remotely...`)
                        }
                    } catch (remoteErr) {
                        logger.error(remoteErr, '❌ [Rembg Animated Remote Error]')
                        throw new Error('Gagal mengeksekusi penghapusan latar belakang animasi (lokal & remote).')
                    }
                }

                // Alihkan target input FFmpeg dari file video mentah ke folder sequence gambar transparan
                ffmpegInputArgs = `-framerate 25 -i "${path.join(framesOutDir, '%04d.png')}"`
            }

            // FIX: Di sini gua bersihkan seutuhnya dari string ${rembgFilter} agar FFmpeg berjalan normal murni!
            const videoFilter = noCrop
                ? `scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=@0x00000000,fps=25,format=rgba`
                : `scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=25,format=rgba`

            // LQ mode: inject additional pixel-scale degradation into video filter
            let lqFilter = ''
            if (lqPercent > 0) {
                const pct = Math.min(100, Math.max(1, lqPercent))
                const scaleDown = Math.max(32, Math.round(512 * (1 - (pct / 100) * 0.9375)))
                lqFilter = `,scale=${scaleDown}:${scaleDown}:flags=neighbor,scale=512:512:flags=neighbor`
            }
            const lqQv = lqPercent > 0 ? Math.round(15 + (80 * (lqPercent / 100))) : 15 // q:v 15=good → 95=worst

            await execPromise(`ffmpeg ${ffmpegInputArgs} -i "${overlayPath}" -filter_complex "[0:v]${videoFilter}${lqFilter}[bg]; [bg][1:v]overlay=0:0" -vcodec libwebp -lossless 0 -compression_level 6 -q:v ${lqQv} -loop 0 -preset default -an -vsync 0 -t 00:00:05 "${outputPath}"`)

            const finalWebpBuffer = fs.readFileSync(outputPath)
            return await addExif(finalWebpBuffer)

        } catch (e) {
            logger.error(e, '❌ toAnimatedMemeSticker error')
            throw new Error('Gagal mengeksekusi siksaan rembg animasi.')
        } finally {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
            if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath)
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)

            if (fs.existsSync(framesInDir)) fs.rmSync(framesInDir, { recursive: true, force: true })
            if (fs.existsSync(framesOutDir)) fs.rmSync(framesOutDir, { recursive: true, force: true })
        }
    }

    async boostMediaVolume(buffer, ext = 'mp4', volumeMultiplier = 2.0) {
        let inputPath, outputPath
        try {
            const tmpDir = path.resolve('./storage/media/tmp')
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

            const id = crypto.randomBytes(4).toString('hex')
            inputPath = path.join(tmpDir, `${id}_in.${ext}`)
            outputPath = path.join(tmpDir, `${id}_out.${ext}`)

            fs.writeFileSync(inputPath, buffer)

            const vcodec = ext === 'mp4' ? '-vcodec copy' : ''
            await execPromise(`ffmpeg -y -i "${inputPath}" ${vcodec} -af "volume=${volumeMultiplier}" "${outputPath}"`)

            return fs.readFileSync(outputPath)
        } catch (err) {
            logger.error('❌ [FFmpeg] Boost Volume Error:', err.message)
            return buffer
        } finally {
            try {
                if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
                if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
            } catch (e) { }
        }
    }
}

export const mediaService = new MediaService()
export default mediaService