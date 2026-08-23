// src/services/media.js
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { exec, execSync } from 'child_process'
import util from 'util'
import crypto from 'crypto'
import { logger } from '../utils/logger.js'
import { addExif } from './exif.js'

const execPromise = util.promisify(exec)

let resolvedFfmpegPath = null
export function getFfmpegPath() {
    if (resolvedFfmpegPath) return resolvedFfmpegPath
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' })
        resolvedFfmpegPath = 'ffmpeg'
        return resolvedFfmpegPath
    } catch {
        const installerPaths = [
            path.resolve('./storage/bin/ffmpeg'),
            path.resolve('./storage/bin/ffmpeg.exe'),
            path.resolve('../Sesuatu/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'),
            path.resolve('./node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe'),
            'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
        ]
        for (const p of installerPaths) {
            if (fs.existsSync(p)) {
                resolvedFfmpegPath = `"${p}"`
                return resolvedFfmpegPath
            }
        }
    }
    resolvedFfmpegPath = 'ffmpeg'
    return resolvedFfmpegPath
}


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
        const words = text.trim().split(/\s+/).filter(Boolean)
        const visualLen = str => {
            const noEmoji = str.replace(EMOJI_REGEX, 'XX')
            return [...noEmoji].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2000 ? 2 : 1), 0)
        }

        let lines = []
        let currentLine = ''

        for (const word of words) {
            const wLen = visualLen(word)
            const lineLen = visualLen(currentLine)

            if (!currentLine) {
                if (wLen <= maxCharsPerLine) {
                    currentLine = word
                } else {
                    let temp = word
                    while (visualLen(temp) > maxCharsPerLine) {
                        let cutIndex = 0
                        let cutLen = 0
                        for (let i = 0; i < temp.length; i++) {
                            const cp = temp.codePointAt(i)
                            const cl = cp > 0x2000 ? 2 : 1
                            if (cutLen + cl > maxCharsPerLine) break
                            cutLen += cl
                            cutIndex = i + 1
                        }
                        if (cutIndex === 0) cutIndex = 1
                        lines.push(temp.substring(0, cutIndex))
                        temp = temp.substring(cutIndex)
                    }
                    if (temp) currentLine = temp
                }
            } else if (lineLen + 1 + wLen <= maxCharsPerLine) {
                currentLine += ' ' + word
            } else {
                lines.push(currentLine)
                if (wLen <= maxCharsPerLine) {
                    currentLine = word
                } else {
                    let temp = word
                    while (visualLen(temp) > maxCharsPerLine) {
                        let cutIndex = 0
                        let cutLen = 0
                        for (let i = 0; i < temp.length; i++) {
                            const cp = temp.codePointAt(i)
                            const cl = cp > 0x2000 ? 2 : 1
                            if (cutLen + cl > maxCharsPerLine) break
                            cutLen += cl
                            cutIndex = i + 1
                        }
                        if (cutIndex === 0) cutIndex = 1
                        lines.push(temp.substring(0, cutIndex))
                        temp = temp.substring(cutIndex)
                    }
                    currentLine = temp
                }
            }
        }
        if (currentLine) lines.push(currentLine)
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
        if (!text) return { lines: [], fontSize: 60, startY: 0, lineSpacing: 0 }

        const clean = text.trim().toUpperCase()
        const words = clean.split(/\s+/).filter(Boolean)
        if (words.length === 0) return { lines: [], fontSize: 60, startY: 0, lineSpacing: 0 }

        // Adaptive target chars per line based on total text length
        let targetChars = 14
        if (clean.length > 35) targetChars = 20
        else if (clean.length > 18) targetChars = 16

        let lines = []
        let current = ''
        for (const w of words) {
            if (!current) {
                current = w
            } else if ((current + ' ' + w).length <= targetChars) {
                current += ' ' + w
            } else {
                lines.push(current)
                current = w
            }
        }
        if (current) lines.push(current)

        // Limit to max 3 lines to maintain aesthetic meme proportion
        if (lines.length > 3) {
            const avgPerLine = Math.ceil(clean.length / 3)
            lines = []
            current = ''
            for (const w of words) {
                if (!current) {
                    current = w
                } else if ((current + ' ' + w).length <= avgPerLine) {
                    current += ' ' + w
                } else {
                    lines.push(current)
                    current = w
                }
            }
            if (current) lines.push(current)
        }

        // Balance 2 lines if very uneven
        if (lines.length === 2 && Math.abs(lines[0].length - lines[1].length) > 8 && words.length >= 3) {
            const mid = Math.ceil(words.length / 2)
            lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
        }

        const maxLineLen = Math.max(...lines.map(l => l.length))
        let fontSize = Math.floor(480 / (maxLineLen * 0.52))
        fontSize = Math.max(30, Math.min(75, fontSize))

        const lineSpacing = fontSize * 1.12
        let startY
        if (isBottom) {
            startY = 512 - 25 - ((lines.length - 1) * lineSpacing)
        } else {
            startY = 25 + fontSize
        }

        return { lines, fontSize, startY, lineSpacing }
    }

    #renderLine(line, y, fontSize, opts) {
        const {
            x = 256,
            textAnchor = 'middle',
            fontFamily = "Impact, 'Arial Narrow', sans-serif",
            fontWeight = 'bold',
            fill = 'white',
            stroke = null,
            strokeWidth = '0',
            emojiMap = new Map(),
            letterSpacing = '0px'
        } = opts

        if (!line || !line.trim()) return ''

        const strokeAttr = stroke ? `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke fill"` : ''
        const emojis = detectEmojis(line)

        // Native SVG text rendering (100% natural typography & kerning) when no emojis
        if (emojis.length === 0) {
            return `<text x="${x}" y="${y}" text-anchor="${textAnchor}" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fontSize}px" fill="${fill}" letter-spacing="${letterSpacing}" ${strokeAttr}>${this.#escapeXml(line)}</text>\n`
        }

        // Line contains emojis: layout segments cleanly
        const emojiSize = fontSize * 1.05
        const isImpact = fontFamily.toLowerCase().includes('impact')
        const charWidth = isImpact ? fontSize * 0.48 : fontSize * 0.42
        const spaceWidth = isImpact ? fontSize * 0.28 : fontSize * 0.22

        const parts = []
        let lastIdx = 0
        for (const match of line.matchAll(EMOJI_REGEX)) {
            const emoji = match[0]
            const matchIdx = match.index
            if (matchIdx > lastIdx) {
                const textPart = line.substring(lastIdx, matchIdx)
                if (textPart) parts.push({ type: 'text', val: textPart })
            }
            parts.push({ type: 'emoji', val: emoji })
            lastIdx = matchIdx + emoji.length
        }
        if (lastIdx < line.length) {
            const remaining = line.substring(lastIdx)
            if (remaining) parts.push({ type: 'text', val: remaining })
        }

        const partWidths = parts.map(p => {
            if (p.type === 'emoji') return emojiSize
            const trimmed = p.val.trim()
            const leadingSpace = p.val.startsWith(' ') ? spaceWidth : 0
            const trailingSpace = p.val.endsWith(' ') ? spaceWidth : 0
            return leadingSpace + ([...trimmed].length * charWidth) + trailingSpace
        })

        const totalWidth = partWidths.reduce((a, b) => a + b, 0)
        let currentX = textAnchor === 'middle' ? (x - totalWidth / 2) : x

        let elements = ''
        parts.forEach((p, i) => {
            const pWidth = partWidths[i]
            if (p.type === 'emoji') {
                const dataUri = emojiMap.get(p.val) ?? emojiMap.get(p.val.trim())
                if (dataUri) {
                    elements += `<image href="${dataUri}" x="${currentX}" y="${y - emojiSize * 0.84}" width="${emojiSize}" height="${emojiSize}"/>\n`
                }
            } else {
                elements += `<text x="${currentX}" y="${y}" text-anchor="start" font-family="${fontFamily}" font-weight="${fontWeight}" font-size="${fontSize}px" fill="${fill}" letter-spacing="${letterSpacing}" ${strokeAttr}>${this.#escapeXml(p.val)}</text>\n`
            }
            currentX += pWidth
        })

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

            let fontSize = Math.floor(460 / (maxVisualLen * 0.44))
            const maxVerticalFontSize = Math.floor(390 / (lines.length * 1.10))
            fontSize = Math.min(fontSize, maxVerticalFontSize)
            fontSize = Math.max(42, Math.min(160, fontSize))

            const lineSpacing = fontSize * 1.10
            const totalTextHeight = lines.length * lineSpacing
            const startY = (512 - totalTextHeight) / 2 + (fontSize * 0.82)

            const emojiMap = await prepareEmojiMap(cleanText)
            let svgContent = ''

            lines.forEach((line, i) => {
                const y = startY + (i * lineSpacing)
                svgContent += this.#renderLine(line, y, fontSize, {
                    x: 28,
                    textAnchor: 'start',
                    fontFamily: "'Arial Narrow', Arial, sans-serif",
                    fontWeight: 'normal',
                    fill: '#000000',
                    emojiMap,
                    letterSpacing: '-2px'
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
        const ffmpegBin = getFfmpegPath()
        await execPromise(
            `${ffmpegBin} -y -i "${inputPath}" -vf "${vfScale}" -crf ${crf} -preset ultrafast -an "${outputPath}"`
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

    async toAnimatedMemeSticker(bufferVideo, topText = '', bottomText = '', noCrop = false, removeBg = false, lqPercent = 0, speedMultiplier = 1.0, maxDuration = 30) {
        const tmpDir = path.resolve('./storage/media/tmp')
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

        const id = crypto.randomBytes(4).toString('hex')
        const isWebp = bufferVideo.length > 12 && bufferVideo.slice(8, 12).toString('ascii') === 'WEBP'

        let finalBufferVideo = bufferVideo
        let extension = 'mp4'

        if (isWebp) {
            extension = 'webp'
        }

        const inputPath = path.join(tmpDir, `${id}_in.${extension}`)
        const overlayPath = path.join(tmpDir, `${id}_overlay.png`)
        const outputPath = path.join(tmpDir, `${id}_out.webp`)

        const framesInDir = path.join(tmpDir, `${id}_frames_in`)
        const framesOutDir = path.join(tmpDir, `${id}_frames_out`)

        const ffmpegBin = getFfmpegPath()

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

            // Dynamic FPS & Quality to ensure resulting WebP is ultra-smooth and strictly under 1MB WhatsApp limit
            let targetFps = 20
            let baseQv = 15
            if (maxDuration > 30) {
                targetFps = 12
                baseQv = 30
            } else if (maxDuration > 10) {
                targetFps = 15
                baseQv = 20
            }

            // Dynamic argument loader untuk FFmpeg input
            let ffmpegInputArgs = `-i "${inputPath}"`

            if (removeBg) {
                logger.info(`🔥 [Siksa CPU] Memulai proses pemecahan frame video/gif (max ${maxDuration}s, fps ${targetFps})...`)
                fs.mkdirSync(framesInDir, { recursive: true })
                fs.mkdirSync(framesOutDir, { recursive: true })

                // Pecah video asal menjadi sequence gambar PNG stabil di rate target FPS (dengan speed up filter & limit durasi)
                const speedFrameFilter = (speedMultiplier && speedMultiplier > 0 && speedMultiplier !== 1)
                    ? `setpts=${(1 / speedMultiplier).toFixed(4)}*PTS,`
                    : ''
                await execPromise(`${ffmpegBin} -i "${inputPath}" -t ${maxDuration} -vf "${speedFrameFilter}fps=${targetFps}" "${path.join(framesInDir, '%04d.png')}"`)

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
                ffmpegInputArgs = `-framerate ${targetFps} -i "${path.join(framesOutDir, '%04d.png')}"`
            }

            const speedFilter = (speedMultiplier && speedMultiplier > 0 && speedMultiplier !== 1 && !removeBg)
                ? `setpts=${(1 / speedMultiplier).toFixed(4)}*PTS,`
                : ''

            const videoFilter = noCrop
                ? `${speedFilter}scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=@0x00000000,fps=${targetFps},format=rgba`
                : `${speedFilter}scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=${targetFps},format=rgba`

            // LQ mode: inject additional pixel-scale degradation into video filter
            let lqFilter = ''
            if (lqPercent > 0) {
                const pct = Math.min(100, Math.max(1, lqPercent))
                const scaleDown = Math.max(32, Math.round(512 * (1 - (pct / 100) * 0.9375)))
                lqFilter = `,scale=${scaleDown}:${scaleDown}:flags=neighbor,scale=512:512:flags=neighbor`
            }
            const lqQv = lqPercent > 0 ? Math.round(baseQv + (80 * (lqPercent / 100))) : baseQv

            await execPromise(`${ffmpegBin} ${ffmpegInputArgs} -i "${overlayPath}" -filter_complex "[0:v]${videoFilter}${lqFilter}[bg]; [bg][1:v]overlay=0:0" -vcodec libwebp -lossless 0 -compression_level 6 -q:v ${lqQv} -loop 0 -preset default -an -vsync 0 -t ${maxDuration} "${outputPath}"`)

            let finalWebpBuffer = fs.readFileSync(outputPath)

            // Dynamic Auto-Compression if WebP size > 980KB (WhatsApp animated sticker limit is ~1MB)
            if (finalWebpBuffer.length > 980 * 1024) {
                const compressedPath = path.join(tmpDir, `${id}_compressed.webp`)
                const reducedFps = Math.max(8, Math.round(targetFps * 0.75))
                const reducedQv = Math.min(65, lqQv + 20)
                const retryVideoFilter = noCrop
                    ? `${speedFilter}scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=@0x00000000,fps=${reducedFps},format=rgba`
                    : `${speedFilter}scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=${reducedFps},format=rgba`
                try {
                    await execPromise(`${ffmpegBin} ${ffmpegInputArgs} -i "${overlayPath}" -filter_complex "[0:v]${retryVideoFilter}${lqFilter}[bg]; [bg][1:v]overlay=0:0" -vcodec libwebp -lossless 0 -compression_level 6 -q:v ${reducedQv} -loop 0 -preset default -an -vsync 0 -t ${maxDuration} "${compressedPath}"`)
                    if (fs.existsSync(compressedPath) && fs.statSync(compressedPath).size > 0) {
                        finalWebpBuffer = fs.readFileSync(compressedPath)
                    }
                } catch (_) {} finally {
                    if (fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath)
                }
            }

            return await addExif(finalWebpBuffer)

        } catch (e) {
            logger.error(e, '❌ toAnimatedMemeSticker error')
            throw new Error('Gagal mengeksekusi animasi stiker meme.')
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

            const ffmpegBin = getFfmpegPath()
            const vcodec = ext === 'mp4' ? '-vcodec copy' : ''
            await execPromise(`${ffmpegBin} -y -i "${inputPath}" ${vcodec} -af "volume=${volumeMultiplier}" "${outputPath}"`)

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

    async convertToPlayableMp4(buffer) {
        let inputPath, outputPath
        try {
            const tmpDir = path.resolve('./storage/media/tmp')
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

            const id = crypto.randomBytes(4).toString('hex')
            inputPath = path.join(tmpDir, `${id}_raw_in.mp4`)
            outputPath = path.join(tmpDir, `${id}_playable_out.mp4`)

            fs.writeFileSync(inputPath, buffer)

            const ffmpegBin = getFfmpegPath()
            // Transcode to H.264 + AAC + yuv420p + faststart for 100% WhatsApp compatibility across Android, iOS & Web
            const ffmpegCmd = `${ffmpegBin} -y -i "${inputPath}" -c:v libx264 -pix_fmt yuv420p -preset ultrafast -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`
            await execPromise(ffmpegCmd)

            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                logger.info(`✅ [FFmpeg] Transcoding video to playable H.264 MP4 completed (${fs.statSync(outputPath).size} bytes)`)
                return fs.readFileSync(outputPath)
            }
            return buffer
        } catch (err) {
            logger.warn(`⚠️ [FFmpeg] Transcode to MP4 failed, returning original buffer: ${err.message}`)
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