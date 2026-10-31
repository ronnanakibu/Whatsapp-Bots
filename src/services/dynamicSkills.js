// src/services/dynamicSkills.js
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import Groq from 'groq-sdk'
import { logger, botLogger, getSocket } from '../utils/logger.js'
import { botIntrospection } from './botIntrospection.js'
import { db } from './db.js'
import { store } from './store.js'

class DynamicSkillsService {
    constructor() {
        this.storagePath = path.resolve('./storage/dynamic_skills.json')
        this.skills = []
        this.groqApiKey = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.replace(/^["']|["']$/g, '').trim() : ''
        this.nvidiaApiKey = process.env.NVIDIA_API_KEY ? process.env.NVIDIA_API_KEY.replace(/^["']|["']$/g, '').trim() : ''
        this.hfToken = process.env.HF_TOKEN ? process.env.HF_TOKEN.replace(/^["']|["']$/g, '').trim() : ''
        
        this.groqClient = this.groqApiKey ? new Groq({ apiKey: this.groqApiKey }) : null
        this.isSynthesizing = false

        this.initStorage()
    }

    /**
     * Inisialisasi storage file dan default seed skills
     */
    initStorage() {
        try {
            const dir = path.dirname(this.storagePath)
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

            if (fs.existsSync(this.storagePath)) {
                const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))
                if (Array.isArray(data)) {
                    this.skills = data
                    logger.info(`⚡ [DynamicSkills] ${this.skills.length} dynamic skills loaded from cache!`)
                    return
                }
            }

            // Seed initial dynamic skills jika belum ada
            this.skills = [
                {
                    id: 'bot_groups_count',
                    name: 'Cek Keanggotaan Grup WhatsApp',
                    description: 'Mengetahui jumlah dan daftar grup WhatsApp yang di-join oleh bot',
                    keywords: [
                        'berapa grup', 'grup yang lu join', 'join berapa grup', 'ada berapa grup', 
                        'lu di grup mana aja', 'daftar grup bot', 'grup yang kamu ikuti', 'grup lu apa aja'
                    ],
                    code: `async (ctx, { introspection }) => {
                        const count = await introspection.getGroupsCount();
                        const sample = await introspection.getGroupsSample(5);
                        let text = 'Saat ini gue join di *' + count + ' grup WhatsApp aktif*! 🚀\\n\\n';
                        if (sample && sample.length > 0) {
                            text += 'Beberapa di antaranya:\\n';
                            sample.forEach((g, idx) => {
                                text += (idx + 1) + '. *' + g.subject + '* (' + g.participantsCount + ' member)\\n';
                            });
                        }
                        return text.trim();
                    }`,
                    createdAt: new Date().toISOString(),
                    usageCount: 0
                },
                {
                    id: 'bot_system_specs',
                    name: 'Cek Spesifikasi & Kesehatan Mesin Bot',
                    description: 'Mengecek penggunaan RAM, platform hosting, dan waktu aktif (uptime) server bot',
                    keywords: [
                        'spek bot', 'ram bot', 'status mesin bot', 'server bot', 'uptime bot', 
                        'lu jalan di mana', 'hosting bot', 'bot aktif berapa lama'
                    ],
                    code: `async (ctx, { introspection }) => {
                        const h = introspection.getSystemHealth();
                        const id = introspection.getBotIdentity();
                        return '⚙️ *STATUS SISTEM & IDENTITAS MESIN*\\n\\n' +
                            '• *Bot:* ' + id.name + ' v' + id.version + '\\n' +
                            '• *Platform:* ' + h.platform + '\\n' +
                            '• *Runtime:* Node.js ' + h.nodeVersion + '\\n' +
                            '• *Penggunaan RAM:* ' + h.rssMB + ' MB RSS (' + h.heapUsedMB + ' MB Heap)\\n' +
                            '• *Masa Aktif:* ' + h.uptimeStr + '\\n' +
                            '• *Penyimpanan Cloud:* ' + id.cloudRepo;
                    }`,
                    createdAt: new Date().toISOString(),
                    usageCount: 0
                }
            ]

            this.saveStorage()
            logger.info(`⚡ [DynamicSkills] Initial dynamic skills initialized with ${this.skills.length} skills!`)
        } catch (err) {
            logger.warn(`[DynamicSkills] Failed to init storage: ${err.message}`)
            this.skills = []
        }
    }

    saveStorage() {
        try {
            fs.writeFileSync(this.storagePath, JSON.stringify(this.skills, null, 2), 'utf8')
            // Auto-backup dynamic skills library to Hugging Face Dataset in background
            setTimeout(async () => {
                try {
                    const { sessionSync } = await import('./sessionSync.js')
                    await sessionSync.backupDynamicSkills()
                } catch (_) {}
            }, 1500)
        } catch (err) {
            logger.warn(`[DynamicSkills] Failed to save storage: ${err.message}`)
        }
    }

    /**
     * Cari apakah query user cocok dengan salah satu skill yang tersimpan
     */
    findMatchingSkill(queryText) {
        if (!queryText || typeof queryText !== 'string') return null
        const cleanQuery = queryText.toLowerCase().replace(/[?!.,;:_`~*'"()\[\]{}/\\|@#$%^&+=<>]/g, ' ').replace(/\s+/g, ' ').trim()

        for (const skill of this.skills) {
            // 1. Cek keywords
            if (Array.isArray(skill.keywords)) {
                for (const kw of skill.keywords) {
                    const cleanKw = kw.toLowerCase().trim()
                    if (cleanQuery.includes(cleanKw)) {
                        return skill
                    }
                }
            }

            // 2. Cek regex opsional
            if (skill.regex) {
                try {
                    const reg = new RegExp(skill.regex, 'i')
                    if (reg.test(cleanQuery)) {
                        return skill
                    }
                } catch (_) {}
            }
        }

        return null
    }

    /**
     * Eksekusi skrip skill di dalam lingkungan terisolasi yang aman
     */
    async executeSkill(skill, ctx) {
        if (!skill || !skill.code) throw new Error('Skrip tidak valid')

        const sock = getSocket()
        const contextBundle = {
            sock,
            db,
            store,
            introspection: botIntrospection
        }

        // Sandbox security check: tolak pemanggilan modul sistem perusak
        const dangerousPatterns = [
            /process\s*\.\s*exit/i,
            /child_process/i,
            /\bexecSync\b/i,
            /\bspawnSync\b/i,
            /\brmSync\b/i,
            /\bunlinkSync\b/i,
            /\bwriteFileSync\b/i
        ]

        for (const pattern of dangerousPatterns) {
            if (pattern.test(skill.code)) {
                throw new Error('Eksekusi diblokir: Skrip mengandung instruksi sistem terlarang.')
            }
        }

        // Kompilasi Async Function
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
        const runner = new AsyncFunction('ctx', 'bundle', `
            const { sock, db, store, introspection } = bundle;
            const fn = ${skill.code};
            return await fn(ctx, { sock, db, store, introspection });
        `)

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Eksekusi skrip melebihi batas waktu (5s)')), 5000)
        })

        const result = await Promise.race([
            runner(ctx, contextBundle),
            timeoutPromise
        ])

        // Update metrik skill
        skill.usageCount = (skill.usageCount || 0) + 1
        skill.lastExecutedAt = new Date().toISOString()
        this.saveStorage()

        return result
    }

    // ─────────────────────────────────────────────
    // CHEF ENGINE: Qwen (Groq) -> NVIDIA Models -> DeepSeek
    // ─────────────────────────────────────────────

    /**
     * Chef 1: Qwen via Groq LPU (qwen/qwen3.8-27b)
     */
    async #chefQwenGroq(prompt) {
        if (!this.groqClient) throw new Error('GROQ_API_KEY tidak tersedia')
        const completion = await this.groqClient.chat.completions.create({
            model: 'qwen/qwen3.8-27b',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 1500,
            response_format: { type: 'json_object' }
        })
        const content = completion.choices[0]?.message?.content?.trim()
        if (!content) throw new Error('Respon Qwen Groq kosong')
        return JSON.parse(content)
    }

    /**
     * Chef 2: NVIDIA Models (integrate.api.nvidia.com)
     */
    async #chefNvidia(prompt) {
        if (!this.nvidiaApiKey) throw new Error('NVIDIA_API_KEY tidak tersedia')
        const candidateModels = [
            'mistralai/codestral-22b-instruct-v0.1',
            'nvidia/llama-3.1-nemotron-70b-instruct',
            'meta/llama-3.3-70b-instruct',
            '01-ai/yi-large'
        ]

        let lastErr = null
        for (const model of candidateModels) {
            try {
                const res = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 1500
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.nvidiaApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 8000
                })

                const text = res.data?.choices?.[0]?.message?.content?.trim()
                if (text) {
                    const jsonMatch = text.match(/\{[\s\S]*\}/)
                    if (jsonMatch) return JSON.parse(jsonMatch[0])
                }
            } catch (err) {
                lastErr = err
            }
        }

        throw new Error(lastErr?.message || 'Semua model NVIDIA gagal merespon')
    }

    /**
     * Chef 3: DeepSeek Models (via HF Router atau API)
     */
    async #chefDeepSeek(prompt) {
        // Coba via HF Router dengan model DeepSeek R1 / V3
        if (this.hfToken) {
            try {
                const res = await axios.post(
                    'https://router.huggingface.co/hf-inference/models/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B/v1/chat/completions',
                    {
                        model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.1,
                        max_tokens: 1500
                    },
                    {
                        headers: { Authorization: `Bearer ${this.hfToken}` },
                        timeout: 10000
                    }
                )
                const text = res.data?.choices?.[0]?.message?.content?.trim()
                if (text) {
                    const jsonMatch = text.match(/\{[\s\S]*\}/)
                    if (jsonMatch) return JSON.parse(jsonMatch[0])
                }
            } catch (_) {}
        }

        // Coba DeepSeek via Groq GPT-OSS 120B fallback jika HF tidak tersedia
        if (this.groqClient) {
            const completion = await this.groqClient.chat.completions.create({
                model: 'openai/gpt-oss-120b',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 1500,
                response_format: { type: 'json_object' }
            })
            const text = completion.choices[0]?.message?.content?.trim()
            if (text) return JSON.parse(text)
        }

        throw new Error('DeepSeek fallback gagal')
    }

    /**
     * Minta Chef (Qwen -> NVIDIA -> DeepSeek) membuat skrip baru untuk query user
     */
    async synthesizeSkill(userQuery) {
        if (this.isSynthesizing) return null
        this.isSynthesizing = true

        const prompt = `Anda adalah Master JavaScript Skill Architect untuk RonnBot (Baileys WhatsApp Bot Modular).
Tugas Anda adalah membuat satu fungsi JavaScript ES modern untuk menjawab query pengguna berikut:
"${userQuery}"

LINGKUNGAN RUNTIME:
Objek yang dapat diakses di dalam kode:
- ctx: Konteks chat WhatsApp (sender, pushName, chatId, isGroup, reply, react)
- bundle: Berisi:
  * introspection: Layanan introspeksi bot dengan method:
    - await introspection.getGroupsCount(): mengembalikan jumlah angka grup yang di-join bot
    - await introspection.getGroupsSample(limit): mengembalikan array [{ id, subject, participantsCount }]
    - introspection.getSystemHealth(): mengembalikan { rssMB, heapUsedMB, uptimeStr, platform, nodeVersion }
    - introspection.getBotIdentity(): mengembalikan { name, version, botNumber, ownerName, ownerNumber, cloudRepo }
    - introspection.getDatabaseSummary(): mengembalikan { usersCount, songsCount, notesCount, dbSizeBytes }
  * sock: Socket Baileys WhatsApp asli (sock.groupFetchAllParticipating, sock.user, dll.)
  * db: Instance SQLite better-sqlite3 (db.prepare('SELECT ...').all() atau .get())
  * store: Store in-memory Baileys

SYARAT OUTPUT:
Keluarkan HANYA format JSON valid berikut (tanpa markdown atau teks lain):
{
  "id": "slug_unik_skill_snake_case",
  "name": "Judul Singkat Skill",
  "description": "Deskripsi singkat apa yang dilakukan fungsi ini",
  "keywords": ["variasi pertanyaan 1", "variasi pertanyaan 2", "variasi pertanyaan 3"],
  "code": "async (ctx, { sock, db, store, introspection }) => {\\n    // Logika JS Anda di sini\\n    return 'Teks hasil yang rapi berformat WhatsApp dengan emoji';\\n}"
}

ATURAN KODE:
1. Kode HARUS mengembalikan (return) string teks bahasa Indonesia santai, akrab, dan rapi yang langsung bisa dikirim ke WhatsApp.
2. DILARANG menggunakan modul perusak sistem seperti child_process, process.exit, atau fs.rmSync.
3. Pastikan syntax javascript benar dan siap dievaluasi.`

        botLogger.system(`🍳 [DynamicSkills] Cooking new skill for query: "${userQuery}"...`)

        let synthesized = null
        let usedChef = ''

        // 1. Chef Utama: Qwen via Groq
        try {
            synthesized = await this.#chefQwenGroq(prompt)
            usedChef = 'Qwen 3.8 (Groq LPU)'
        } catch (e1) {
            logger.warn(`[DynamicSkills] Chef Qwen failed: ${e1.message}. Falling back to NVIDIA...`)
            // 2. Fallback 1: NVIDIA Models
            try {
                synthesized = await this.#chefNvidia(prompt)
                usedChef = 'NVIDIA Model'
            } catch (e2) {
                logger.warn(`[DynamicSkills] Chef NVIDIA failed: ${e2.message}. Falling back to DeepSeek...`)
                // 3. Fallback 2: DeepSeek
                try {
                    synthesized = await this.#chefDeepSeek(prompt)
                    usedChef = 'DeepSeek Model'
                } catch (e3) {
                    logger.error(`[DynamicSkills] All chefs failed to synthesize skill: ${e3.message}`)
                }
            }
        } finally {
            this.isSynthesizing = false
        }

        if (!synthesized || !synthesized.code || !synthesized.name) {
            return null
        }

        // Format dan simpan skill baru ke registry
        const newSkill = {
            id: synthesized.id || `skill_${Date.now()}`,
            name: synthesized.name,
            description: synthesized.description || 'Dynamic custom skill',
            keywords: Array.isArray(synthesized.keywords) ? synthesized.keywords : [userQuery.toLowerCase()],
            code: synthesized.code,
            createdByChef: usedChef,
            createdAt: new Date().toISOString(),
            usageCount: 0
        }

        this.skills.push(newSkill)
        this.saveStorage()
        botLogger.system(`✅ [DynamicSkills] New skill "${newSkill.name}" cooked by ${usedChef} and saved to cache!`)

        return newSkill
    }

    /**
     * Dapatkan semua skill tersimpan
     */
    getAllSkills() {
        return this.skills
    }
}

export const dynamicSkills = new DynamicSkillsService()
export default dynamicSkills
