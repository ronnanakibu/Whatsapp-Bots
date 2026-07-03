// src/services/ai.js
// Dual AI Engine: Groq (fast) + Gemini (vision, image gen)
// Features: chat memory, model pool rotation, vision, image generation

import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import { memoryService } from './memory.js'
import { logger } from '../utils/logger.js'

// ─────────────────────────────────────────────
// CLIENT INIT
// ─────────────────────────────────────────────

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const nvidiaClient = process.env.NVIDIA_API_KEY ? new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1'
}) : null

export const BRAINS = {
    nvidia: { name: 'NVIDIA Nemotron 70B', model: 'nvidia/llama-3.1-nemotron-70b-instruct', provider: 'nvidia' },
    groq: { name: 'Groq Llama 3.3', model: 'llama-3.3-70b-versatile', provider: 'groq' },
    gemini: { name: 'Google Gemini Flash', model: 'gemini-2.0-flash', provider: 'gemini' },
    gpt_oss: { name: 'OpenAI GPT-OSS 120B', model: 'openai/gpt-oss-120b', provider: 'nvidia' },
    nemotron_super: { name: 'NVIDIA Nemotron-3 Super 120B', model: 'nvidia/nemotron-3-super-120b-a12b', provider: 'nvidia' },
    llama3_3: { name: 'Meta Llama 3.3 70B', model: 'meta/llama-3.3-70b-instruct', provider: 'nvidia' },
    qwen3: { name: 'Qwen3 Next 80B', model: 'qwen/qwen3-next-80b-a3b-instruct', provider: 'nvidia' },
    gemma4: { name: 'Google Gemma 4 31B', model: 'google/gemma-4-31b-it', provider: 'nvidia' },
    kimi: { name: 'Moonshot AI Kimi K2.6', model: 'moonshotai/kimi-k2.6', provider: 'nvidia' },
    deepseek_flash: { name: 'DeepSeek V4 Flash', model: 'deepseek-ai/deepseek-v4-flash', provider: 'nvidia' },
    deepseek_pro: { name: 'DeepSeek V4 Pro', model: 'deepseek-ai/deepseek-v4-pro', provider: 'nvidia' },
    nemotron_voice: { name: 'NVIDIA Nemotron VoiceChat', model: 'nvidia/nemotron-voicechat', provider: 'nvidia' },
}


// ─────────────────────────────────────────────
// MODEL POOL
// Rotasi otomatis kalau satu model rate-limited
// ─────────────────────────────────────────────

const NVIDIA_MODELS = [
    'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct',
    'nvidia/llama-3.1-nemotron-70b-instruct',
]

const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
]

const GEMINI_MODELS = [
    'gemini-2.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash',
]

// Track model yang sedang di-cooldown (rate limited)
const modelCooldowns = new Map() // modelName → timestamp when available again

function getAvailableModel(pool) {
    const now = Date.now()
    for (const model of pool) {
        const availableAt = modelCooldowns.get(model) ?? 0
        if (now >= availableAt) return model
    }
    // Semua cooldown — pakai yang paling cepat available
    let earliest = Infinity, pick = pool[0]
    for (const model of pool) {
        const t = modelCooldowns.get(model) ?? 0
        if (t < earliest) { earliest = t; pick = model }
    }
    return pick
}

function setCooldown(model, durationMs = 60_000) {
    modelCooldowns.set(model, Date.now() + durationMs)
    logger.warn(`[AI] Model ${model} cooldown ${durationMs / 1000}s`)
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────

const BOT_NAME = process.env.BOT_NAME ?? 'RonnBot'
const OWNER_NAME = process.env.OWNER_NAME ?? 'Owner'

const DEFAULT_SYSTEM_PROMPT = `Kamu adalah ${BOT_NAME}, asisten AI yang cerdas, helpful, dan sedikit nyantai.
Dibuat oleh ${OWNER_NAME}. Kamu berjalan di WhatsApp sebagai bot.

Aturan:
- Jawab dalam bahasa yang sama dengan user (Indonesia/English/campur = ikuti)
- Boleh santai , tapi tetap helpful dan jangan cringe
- Jawaban ringkas untuk pertanyaan simple, detail untuk yang kompleks
- Jangan sebut dirimu sebagai Groq/Gemini/AI model tertentu — kamu adalah ${BOT_NAME}
- Kalau ada konteks percakapan sebelumnya, gunakan untuk jawaban yang lebih relevan.

🤖 AGEN & SKILLS (PENTING):
Kamu memiliki akses ke berbagai "skills" berupa perintah bot. Jika pengguna secara eksplisit meminta kamu untuk melakukan aksi yang sesuai dengan salah satu perintah di bawah ini (misalnya membuat stiker, download media, cek cuaca, dll), kamu HARUS merespon HANYA dengan format JSON berikut tanpa teks penjelasan lainnya:
{
  "executeCommand": true,
  "command": "nama_command",
  "args": ["argumen1", "argumen2", ...]
}

Daftar Perintah (Skills) yang Tersedia:
1. 'sticker' (alias: 'stiker'): Membuat stiker dari gambar/video/gif (baik gambar langsung atau quote gambar orang lain). Gunakan jika pengguna meminta membuat stiker dari media. Argumen: teks stiker (opsional), jika ada teks atas dan bawah dipisahkan dengan '|'. Contoh: ["Meme", "|", "Lucu"].
2. 'anomali' (alias: 'qs', 'qc', 'quote', 'brat'): Membuat stiker teks anomali tipis ala brat generator. Gunakan jika pengguna meminta stiker teks/tulisan saja tanpa gambar. Argumen: teks stiker. Contoh: ["teks stiker"].
3. 'dl' (alias: 'download', 'unduh'): Mengunduh video/audio dari media sosial (TikTok, Instagram, YouTube, Facebook). Argumen: [URL media sosial]. Contoh: ["https://instagram.com/..."]
4. 'cuaca': Memeriksa prakiraan cuaca di suatu lokasi/kota. Argumen: [nama lokasi]. Contoh: ["Jakarta"]
5. 'cekhoax': Memeriksa kebenaran atau memverifikasi fakta atas suatu isu/berita. Argumen: [berita/isu]. Contoh: ["bumi datar"]
6. 'buat' (alias: 'image'): Membuat gambar baru dengan AI (image generation). Argumen: [deskripsi gambar/prompt]. Contoh: ["kucing astronot"]
7. 'ocr': Membaca teks dari gambar (baik gambar langsung atau quote gambar). Argumen: tidak ada.
8. 'stalk': Mencari informasi profile instagram/tiktok/github/dll dari username. Argumen: [username]. Contoh: ["jokowi"]
9. 'summarize': Merangkum teks yang sangat panjang menjadi ringkas. Argumen: [teks panjang].
10. 'ping': Mengecek kecepatan/latensi respon bot. Argumen: tidak ada.
11. 'uptime': Mengecek berapa lama bot sudah aktif berjalan. Argumen: tidak ada.

ATURAN JSON:
- Balas HANYA dengan JSON murni di atas tanpa kata pengantar atau penutup. Jangan letakkan penjelasan apa pun.`

function getDynamicSystemPrompt() {
    const now = new Date()
    const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' })
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })

    const basePrompt = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT

    return `${basePrompt}

🕒 Info Waktu & Tanggal Real-time saat ini:
- Hari/Tanggal: ${dateStr}
- Waktu: ${timeStr} WIB`
}

// ─────────────────────────────────────────────
// NVIDIA CHAT (primary — paling pintar & cepat)
// ─────────────────────────────────────────────

async function nvidiaChat(chatId, userMessage, retryCount = 0) {
    if (!nvidiaClient) throw new Error('NVIDIA API Key not configured')
    const model = getAvailableModel(NVIDIA_MODELS)
    const history = memoryService.getHistory(chatId)

    const messages = [
        { role: 'system', content: getDynamicSystemPrompt() },
        ...history,
        { role: 'user', content: userMessage }
    ]

    try {
        const res = await nvidiaClient.chat.completions.create({
            model,
            messages,
            max_tokens: 1024,
            temperature: 0.7,
        })

        const reply = res.choices[0]?.message?.content?.trim()
        if (!reply) throw new Error('Empty response from NVIDIA')

        return { text: reply, model, provider: 'nvidia' }

    } catch (err) {
        const isRateLimit = err?.status === 429 || err?.message?.includes('rate')
        const isModelError = err?.status === 400

        if (isRateLimit) {
            setCooldown(model, 60_000)
            if (retryCount < NVIDIA_MODELS.length) {
                logger.warn(`[AI] NVIDIA rate limit on ${model}, retrying...`)
                return nvidiaChat(chatId, userMessage, retryCount + 1)
            }
        }

        if (isModelError && retryCount < NVIDIA_MODELS.length) {
            setCooldown(model, 30_000)
            return nvidiaChat(chatId, userMessage, retryCount + 1)
        }

        throw err
    }
}

// ─────────────────────────────────────────────
// GROQ CHAT (fallback 1)
// ─────────────────────────────────────────────

async function groqChat(chatId, userMessage, retryCount = 0) {
    const model = getAvailableModel(GROQ_MODELS)
    const history = memoryService.getHistory(chatId)

    const messages = [
        { role: 'system', content: getDynamicSystemPrompt() },
        ...history,
        { role: 'user', content: userMessage }
    ]

    try {
        const res = await groq.chat.completions.create({
            model,
            messages,
            max_tokens: 1024,
            temperature: 0.7,
        })

        const reply = res.choices[0]?.message?.content?.trim()
        if (!reply) throw new Error('Empty response from Groq')

        return { text: reply, model, provider: 'groq' }

    } catch (err) {
        const isRateLimit = err?.status === 429 || err?.message?.includes('rate')
        const isModelError = err?.status === 400

        if (isRateLimit) {
            setCooldown(model, 90_000)
            if (retryCount < GROQ_MODELS.length) {
                logger.warn(`[AI] Groq rate limit on ${model}, retrying...`)
                return groqChat(chatId, userMessage, retryCount + 1)
            }
        }

        if (isModelError && retryCount < GROQ_MODELS.length) {
            setCooldown(model, 30_000)
            return groqChat(chatId, userMessage, retryCount + 1)
        }

        throw err
    }
}

// ─────────────────────────────────────────────
// GEMINI CHAT (fallback + vision)
// ─────────────────────────────────────────────

async function geminiChat(chatId, userMessage, retryCount = 0) {
    const modelName = getAvailableModel(GEMINI_MODELS)
    const model = genAI.getGenerativeModel({ model: modelName })
    const history = memoryService.getHistory(chatId)

    // Convert history ke format Gemini
    const geminiHistory = history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
    }))

    try {
        const chat = model.startChat({
            history: [
                { role: 'user', parts: [{ text: getDynamicSystemPrompt() }] },
                { role: 'model', parts: [{ text: `Siap! Saya ${BOT_NAME}, asisten AI kamu.` }] },
                ...geminiHistory
            ],
            generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
        })

        const result = await chat.sendMessage(userMessage)
        const reply = result.response.text()?.trim()
        if (!reply) throw new Error('Empty response from Gemini')

        return { text: reply, model: modelName, provider: 'gemini' }

    } catch (err) {
        const isRateLimit = err?.status === 429
        if (isRateLimit) {
            setCooldown(modelName, 60_000)
            if (retryCount < GEMINI_MODELS.length) {
                return geminiChat(chatId, userMessage, retryCount + 1)
            }
        }
        throw err
    }
}

// ─────────────────────────────────────────────
// VISION AI — Analisa gambar via Gemini
// ─────────────────────────────────────────────

async function analyzeImage(imageBuffer, mimeType = 'image/jpeg', prompt = 'Deskripsikan gambar ini secara detail.') {
    const modelName = getAvailableModel(GEMINI_MODELS)
    const model = genAI.getGenerativeModel({ model: modelName })

    const imagePart = {
        inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType
        }
    }

    try {
        const result = await model.generateContent([prompt, imagePart])
        const reply = result.response.text()?.trim()
        if (!reply) throw new Error('Empty vision response')
        return { text: reply, model: modelName, provider: 'gemini' }
    } catch (err) {
        if (err?.status === 429) setCooldown(modelName, 60_000)
        throw err
    }
}

async function enhancePrompt(rawPrompt) {
    try {
        logger.info(`[AI] Enhancing prompt via Gemini...`)
        const enhancerModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
        const instructions = `
            You are an expert AI prompt engineer. 
            The user wants to generate media (image/video) based on this input: "${rawPrompt}"
            Write a highly detailed, descriptive, and visually rich prompt in English.
            Focus on subject details, lighting, camera angles, art style, and atmosphere.
            IMPORTANT: Return ONLY the prompt text, no intro, no explanation, no quotes.
        `
        const enhanceRes = await enhancerModel.generateContent(instructions)
        const enhanced = enhanceRes.response.text()?.trim()
        if (enhanced && enhanced.length > 10) {
            logger.info(`[AI] Enhanced Prompt: ${enhanced.slice(0, 100)}...`)
            return enhanced
        }
    } catch (e) {
        logger.warn(`[AI] Gagal enhance prompt: ${e.message}`)
    }
    return rawPrompt // Fallback ke prompt asli
}

// ─────────────────────────────────────────────
// IMAGE GENERATION — via Gemini Imagen / fallback prompt
// ─────────────────────────────────────────────

async function generateImage(rawPrompt) {
    // 1. ENHANCE PROMPT WITH GEMINI (Biar hasilnya sekelas Midjourney/DALL-E)
    const prompt = await enhancePrompt(rawPrompt)

    // Mode 1: Hugging Face (jika ada HF_TOKEN di .env)
    if (process.env.HF_TOKEN) {
        try {
            logger.info(`[AI] Generating image via Hugging Face (FLUX.1-schnell)...`)
            const res = await fetch(
                "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
                {
                    headers: {
                        Authorization: `Bearer ${process.env.HF_TOKEN}`,
                        "Content-Type": "application/json"
                    },
                    method: "POST",
                    body: JSON.stringify({ inputs: prompt }),

                }
            )
            if (res.ok) {
                const arrayBuffer = await res.arrayBuffer()
                return {
                    buffer: Buffer.from(arrayBuffer),
                    mimeType: 'image/jpeg',
                    provider: 'huggingface'
                }
            }
            const errText = await res.text()
            logger.warn(`[AI] Hugging Face failed with status ${res.status}: ${errText}, falling back to Pollinations`)
        } catch (hfErr) {
            logger.warn(`[AI] Hugging Face error: ${hfErr.message}, falling back to Pollinations`)
        }
    }

    // Mode 2: Pollinations.ai (Free, no key)
    try {
        logger.info(`[AI] Generating image via Pollinations.ai for: ${prompt}`)
        const res = await fetch(
            `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true&private=true`
        )
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}))
            throw new Error(errData.error || `HTTP error ${res.status}`)
        }

        const arrayBuffer = await res.arrayBuffer()
        return {
            buffer: Buffer.from(arrayBuffer),
            mimeType: 'image/jpeg',
            provider: 'pollinations'
        }
    } catch (err) {
        logger.error('[AI] Image generation failed:', err.message)
        throw new Error(
            `${err.message}.\n\n` +
            `💡 *Tips:* Jika terkena limit/antrean, kamu bisa mendaftar token Hugging Face gratis dan memasukkannya ke file .env sebagai \`HF_TOKEN\` untuk menggunakan model FLUX.1 yang sangat stabil.`
        )
    }
}

// ─────────────────────────────────────────────
// CODE DEBUGGER
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// NVIDIA KIMI K2.6 CHAT
// ─────────────────────────────────────────────

async function kimiChat(prompt, systemInstruction = null) {
    if (!nvidiaClient) throw new Error('NVIDIA_API_KEY tidak dikonfigurasi di file .env')

    const messages = []
    if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction })
    }
    messages.push({ role: 'user', content: prompt })

    try {
        const res = await nvidiaClient.chat.completions.create({
            model: 'moonshotai/kimi-k2.6',
            messages,
            max_tokens: 4096,
            temperature: 0.3,
        })

        const reply = res.choices[0]?.message?.content?.trim()
        if (!reply) throw new Error('Empty response from NVIDIA Kimi K2.6')

        return { text: reply, model: 'moonshotai/kimi-k2.6', provider: 'nvidia-kimi' }
    } catch (err) {
        logger.error(`[AI/Kimi] Gagal memanggil Kimi K2.6: ${err.message}`)
        throw err
    }
}

async function debugCode(code, language = 'auto', chatId = null) {
    const prompt = `Kamu adalah senior software engineer.
Analisa kode berikut dan berikan:
1. **Bug/Error** yang ditemukan (kalau ada)
2. **Penjelasan** kenapa error terjadi  
3. **Kode yang sudah diperbaiki**
4. **Tips** tambahan kalau relevan

Bahasa: ${language === 'auto' ? 'deteksi otomatis' : language}

\`\`\`
${code}
\`\`\`

Jawab dalam bahasa Indonesia, format rapi dengan markdown.`

    return kimiChat(prompt, 'Kamu adalah asisten pengembang senior yang andal dalam menganalisis kode dan memberikan solusi perbaikan bug secara akurat.')
}

// ─────────────────────────────────────────────
// DAILY FACTS
// ─────────────────────────────────────────────

async function getDailyFact(topic = null) {
    const topics = [
        'sains', 'teknologi', 'sejarah', 'alam', 'psikologi',
        'matematika', 'fisika', 'biologi', 'astronomi', 'kimia'
    ]
    const picked = topic ?? topics[Math.floor(Math.random() * topics.length)]

    const prompt = `Berikan 1 fakta menarik dan mengejutkan tentang ${picked}.
Format: 
🔬 *Fakta ${picked.charAt(0).toUpperCase() + picked.slice(1)}*
[isi fakta, 2-3 kalimat, informatif dan engaging]

Sumber: [sebutkan sumber/konteks singkat]`

    // Gunakan Groq untuk kecepatan, tanpa memory (standalone)
    const model = getAvailableModel(GROQ_MODELS)
    const res = await groq.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: 'Kamu adalah ensiklopedia yang memberikan fakta menarik dan akurat.' },
            { role: 'user', content: prompt }
        ],
        max_tokens: 256,
        temperature: 0.9,
    })
    return { text: res.choices[0]?.message?.content?.trim(), provider: 'groq', model }
}

// ─────────────────────────────────────────────
// MAIN CHAT — Auto fallback NVIDIA → Groq → Gemini
// ─────────────────────────────────────────────

function cleanMemoryMessage(text) {
    if (!text) return text
    if (text.includes('{') && text.includes('}')) {
        let cleanText = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/, '')
            .replace(/```\s*$/, '')
            .trim()
        try {
            const startIdx = cleanText.indexOf('{')
            const endIdx = cleanText.lastIndexOf('}')
            if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const jsonStr = cleanText.substring(startIdx, endIdx + 1)
                const parsed = JSON.parse(jsonStr)
                if (parsed.executeCommand && parsed.command) {
                    return `[Mengaktifkan fitur ${parsed.command}]`
                }
            }
        } catch (_) {}
    }
    return text
}

async function nvidiaChatWithModel(chatId, userMessage, model, providerName, retryCount = 0) {
    if (!nvidiaClient) throw new Error('NVIDIA API Key not configured')
    const history = memoryService.getHistory(chatId)

    const messages = [
        { role: 'system', content: getDynamicSystemPrompt() },
        ...history,
        { role: 'user', content: userMessage }
    ]

    try {
        const isReasoning = providerName.includes('kimi') || providerName.includes('pro')
        const res = await nvidiaClient.chat.completions.create({
            model,
            messages,
            max_tokens: 2048,
            temperature: isReasoning ? 0.3 : 0.7,
        })

        const reply = res.choices[0]?.message?.content?.trim()
        if (!reply) throw new Error(`Empty response from NVIDIA model ${model}`)

        return { text: reply, model, provider: providerName }

    } catch (err) {
        logger.error(`[AI/${providerName}] Error calling model ${model}: ${err.message}`)
        throw err
    }
}

async function chat(chatId, userMessage, forcedProvider = null) {
    // Tentukan provider utama (dari parameter, database memori, atau default 'groq')
    let provider = forcedProvider || memoryService.getAiProvider(chatId) || 'groq'
    let result = null

    if (BRAINS[provider]) {
        const brain = BRAINS[provider];
        if (brain.provider === 'nvidia') {
            if (!nvidiaClient) {
                logger.warn(`[AI] NVIDIA API key not configured for brain ${provider}, falling back to Groq`)
                provider = 'groq'
            } else {
                try {
                    result = await nvidiaChatWithModel(chatId, userMessage, brain.model, provider)
                } catch (err) {
                    logger.warn(`[AI] NVIDIA brain ${provider} failed (${err.message}), falling back to Groq`)
                    provider = 'groq'
                }
            }
        } else if (brain.provider === 'groq') {
            try {
                result = await groqChat(chatId, userMessage)
            } catch (err) {
                logger.warn(`[AI] Groq failed (${err.message}), falling back to Gemini`)
                provider = 'gemini'
            }
        } else if (brain.provider === 'gemini') {
            try {
                result = await geminiChat(chatId, userMessage)
            } catch (err) {
                logger.error('[AI] Gemini failed:', err.message)
                throw new Error('Semua AI provider sedang sibuk. Coba lagi sebentar.')
            }
        }
    } else {
        // Fallback jika provider legacy/tidak terdaftar
        if (provider === 'nvidia') {
            if (!nvidiaClient) {
                logger.warn('[AI] NVIDIA API key not configured, falling back to Groq')
                provider = 'groq'
            } else {
                try {
                    result = await nvidiaChat(chatId, userMessage)
                } catch (err) {
                    logger.warn(`[AI] NVIDIA failed (${err.message}), falling back to Groq`)
                    provider = 'groq'
                }
            }
        }
    }

    if (provider === 'groq' && !result) {
        try {
            result = await groqChat(chatId, userMessage)
        } catch (err) {
            logger.warn(`[AI] Groq failed (${err.message}), falling back to Gemini`)
            provider = 'gemini'
        }
    }

    if (provider === 'gemini' && !result) {
        try {
            result = await geminiChat(chatId, userMessage)
        } catch (err) {
            logger.error('[AI] Gemini failed:', err.message)
            throw new Error('Semua AI provider sedang sibuk. Coba lagi sebentar.')
        }
    }

    if (result && result.text) {
        if (!chatId.startsWith('__')) {
            const cleanText = cleanMemoryMessage(result.text)
            memoryService.addMessage(chatId, 'user', userMessage)
            memoryService.addMessage(chatId, 'assistant', cleanText)
        }
    }

    return result
}


// ─────────────────────────────────────────────
// FACT CHECKER — Standalone Gemini Tanpa Memori
// ─────────────────────────────────────────────

async function geminiFactCheck(query) {
    const modelName = getAvailableModel(GEMINI_MODELS)
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: "Anda adalah sistem verifikasi fakta otomatis. Anda BUKAN asisten obrolan santai. JANGAN menggunakan kata sapaan, basa-basi, atau intro seperti 'Baiklah', 'Siap', 'Mari kita bedah'. Output Anda HARUS murni berupa laporan faktual yang objektif, analitis, rinci, dan langsung pada intinya."
    })

    const prompt = `Lakukan riset di internet untuk memverifikasi kebenaran informasi/berita berikut:\n\n"${query}"\n\nJawab LANGSUNG tanpa basa-basi menggunakan format persis seperti di bawah ini:\n\n*1. STATUS:* [Fakta / Hoax / Konteks Keliru / Disinformasi]\n\n*2. RINGKASAN SUMBER & KLAIM:* [Jelaskan secara detail apa inti dari informasi/klaim tersebut dan dari mana asalnya]\n\n*3. ANALISIS FAKTA:* [Berikan penjelasan mendalam, uraikan fakta sebenarnya yang terjadi di lapangan berdasarkan sumber kredibel yang Anda temukan]\n\n*4. DAFTAR REFERENSI:* [Berikan daftar bullet point berisi link/URL sumber berita terpercaya yang memvalidasi analisis Anda]`

    try {
        const result = await model.generateContent(prompt)
        const reply = result.response.text()?.trim()
        if (!reply) throw new Error('Empty response from Gemini')
        return { text: reply, model: modelName, provider: 'gemini' }
    } catch (err) {
        if (err?.status === 429) setCooldown(modelName, 60_000)
        throw err
    }
}

async function generateYoutubeMetadata(vibePrompt) {
    const modelName = getAvailableModel(GEMINI_MODELS)
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: "application/json" }
    })

    const promptText = `
      You are a creative YouTube content creator.
      Based on this music genre/vibe description: "${vibePrompt}"
      Generate:
      1. An engaging, SEO-friendly video Title in Indonesian/English (around 50-70 characters).
      2. A detailed Description (around 500-1000 characters) including track info, vibes, and standard hashtags.
      3. A list of 10-15 relevant Tags.
      4. A highly descriptive Image Prompt (in English) for generating a premium 16:9 thumbnail matching the mood/genre of the song. Do NOT include words like "text", "watermark", "title" in the image prompt.

      Return the result as a raw JSON object with keys: "title", "description", "tags" (array of strings), "imagePrompt".
    `

    try {
        const result = await model.generateContent(promptText)
        const text = result.response.text()?.trim()
        return JSON.parse(text)
    } catch (err) {
        logger.error(`[AI] Failed to generate YouTube metadata: ${err.message}`)
        throw err
    }
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

export const aiService = {
    chat,
    analyzeImage,
    generateImage,
    enhancePrompt,
    generateYoutubeMetadata,
    debugCode,  // sudah handle chatId
    getDailyFact,
    nvidiaChat,
    nvidiaChatWithModel,
    groqChat,
    geminiChat,
    geminiFactCheck,
    kimiChat,
    BRAINS,
}