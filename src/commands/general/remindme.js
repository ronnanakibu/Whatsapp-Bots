// src/commands/general/remindme.js
// !remindme — Set reminder dengan react alarm

import Database from 'better-sqlite3'
import path from 'path'
import { triggerAlarm } from '../../services/alarm.js'
import { logger } from '../../utils/logger.js'

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')

function getDb() {
    const db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')

    // Step 1: buat tabel dasar dulu
    db.exec(`
        CREATE TABLE IF NOT EXISTS reminders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_jid    TEXT    NOT NULL,
            chat_id     TEXT    NOT NULL,
            message     TEXT    NOT NULL,
            fire_at     INTEGER NOT NULL,
            fired       INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS reminder_prefs (
            user_jid    TEXT    PRIMARY KEY,
            updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );
    `)

    // Step 2: migrate kolom
    try { db.exec(`ALTER TABLE reminders ADD COLUMN use_call INTEGER NOT NULL DEFAULT 1`) } catch (_) { }
    try { db.exec(`ALTER TABLE reminders ADD COLUMN quoted_msg TEXT`) } catch (_) { }

    // Step 3: index
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders(fire_at, fired)`) }
    catch (_) { }

    return db
}

// ─────────────────────────────────────────────
// TIME PARSER
// ─────────────────────────────────────────────

function getNowInTz() {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    })
    const parts = formatter.formatToParts(now)
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
    return {
        year: parseInt(p.year),
        month: parseInt(p.month) - 1,
        day: parseInt(p.day),
        hour: parseInt(p.hour),
        minute: parseInt(p.minute),
        second: parseInt(p.second),
        time: now.getTime()
    }
}

function targetTzToMs(year, month, day, hour, minute, second) {
    const utcDate = new Date(Date.UTC(year, month, day, hour, minute, second))
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    })
    const parts = formatter.formatToParts(utcDate)
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
    const formattedUtc = Date.UTC(
        parseInt(p.year),
        parseInt(p.month) - 1,
        parseInt(p.day),
        parseInt(p.hour),
        parseInt(p.minute),
        parseInt(p.second)
    )
    const offsetMs = formattedUtc - utcDate.getTime()
    return utcDate.getTime() - offsetMs
}

function cleanMessage(msg) {
    msg = msg.trim()
    msg = msg.replace(/^[:\-|,\s]+/, '').trim()
    const connectorRegex = /^(?:untuk|buat|agar|supaya|to|for)\s+/i
    if (connectorRegex.test(msg)) {
        msg = msg.replace(connectorRegex, '').trim()
    }
    msg = msg.replace(/^[:\-|,\s]+/, '').trim()
    return msg
}

function parseReminder(inputStr) {
    let workStr = inputStr.trim()
    
    const leadingPrep = /^(?:in|dalam|selama)\s+/i
    if (leadingPrep.test(workStr)) {
        workStr = workStr.replace(leadingPrep, '')
    }

    // --- STRATEGY 0: Exact Date Time (e.g. 5/06/2026 15:00) ---
    const exactDateRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2})(?::|\.)(\d{2})\b\s*/i
    const matchExact = workStr.match(exactDateRegex)
    if (matchExact) {
        const day = parseInt(matchExact[1])
        const month = parseInt(matchExact[2]) - 1 // JS months are 0-11
        const year = parseInt(matchExact[3])
        const hour = parseInt(matchExact[4])
        const minute = parseInt(matchExact[5])

        const targetTs = targetTzToMs(year, month, day, hour, minute, 0)
        const now = Date.now()
        const diffMs = targetTs - now
        
        if (diffMs > 0) {
            return {
                timeMs: diffMs,
                message: cleanMessage(workStr.replace(exactDateRegex, ''))
            }
        }
    }

    // --- STRATEGY 1: Relative Duration ---
    const relativeUnitRegex = /^(?:in\s+)?(\d+)\s*(detik|sec(?:ond)?s?|s|menit|min(?:ute)?s?|m|jam|h(?:ou)?r?s?|h|hari|days?|d|minggu|weeks?|w)(?=\d|\W|$)\s*(?:dan|lebih|,)?\s*/i
    const unitMultipliers = {
        'detik': 1000, 'sec': 1000, 'secs': 1000, 'second': 1000, 'seconds': 1000, 's': 1000,
        'menit': 60000, 'min': 60000, 'mins': 60000, 'minute': 60000, 'minutes': 60000, 'm': 60000,
        'jam': 3600000, 'hr': 3600000, 'hrs': 3600000, 'hour': 3600000, 'hours': 3600000, 'h': 3600000,
        'hari': 86400000, 'day': 86400000, 'days': 86400000, 'd': 86400000,
        'minggu': 604800000, 'week': 604800000, 'weeks': 604800000, 'w': 604800000
    }

    let totalDuration = 0
    let tempStr = workStr
    let matchedRelative = false

    while (true) {
        const match = tempStr.match(relativeUnitRegex)
        if (!match) break

        const val = parseInt(match[1])
        const unit = match[2].toLowerCase()
        const mult = unitMultipliers[unit]

        if (mult) {
            totalDuration += val * mult
            tempStr = tempStr.replace(relativeUnitRegex, '')
            matchedRelative = true
        } else {
            break
        }
    }

    if (matchedRelative && totalDuration > 0) {
        return {
            timeMs: totalDuration,
            message: cleanMessage(tempStr)
        }
    }

    // --- STRATEGY 2: Absolute Time ---
    let dayOffset = 0
    let dayPeriod = null
    let tempStrAbs = workStr

    const tomorrowRegex = /^(?:besok|tomorrow)\b\s*/i
    const lusaRegex = /^(?:lusa|day\s+after\s+tomorrow)\b\s*/i
    const nantiRegex = /^(?:nanti|hari\s+ini|today|later)\b\s*/i

    if (tomorrowRegex.test(tempStrAbs)) {
        dayOffset = 1
        tempStrAbs = tempStrAbs.replace(tomorrowRegex, '')
    } else if (lusaRegex.test(tempStrAbs)) {
        dayOffset = 2
        tempStrAbs = tempStrAbs.replace(lusaRegex, '')
    } else if (nantiRegex.test(tempStrAbs)) {
        dayOffset = 0
        tempStrAbs = tempStrAbs.replace(nantiRegex, '')
    }

    const dayPeriodRegex = /^(?:pagi|siang|sore|malam|morning|afternoon|evening|night)\b\s*/i
    const periodMatch = tempStrAbs.match(dayPeriodRegex)
    if (periodMatch) {
        dayPeriod = periodMatch[0].trim().toLowerCase()
        tempStrAbs = tempStrAbs.replace(dayPeriodRegex, '')
    }

    const timeIndicatorRegex = /^(?:jam|pukul|at|time)\b\s*/i
    if (timeIndicatorRegex.test(tempStrAbs)) {
        tempStrAbs = tempStrAbs.replace(timeIndicatorRegex, '')
    }

    const timeTimeRegex = /^(\d{1,2})(?::|\.)(\d{2})\b\s*/i
    const hourOnlyRegex = /^(\d{1,2})\b\s*/i

    let hour = null
    let minute = 0
    let matchedAbsTime = false
    let match = tempStrAbs.match(timeTimeRegex)

    if (match) {
        hour = parseInt(match[1])
        minute = parseInt(match[2])
        tempStrAbs = tempStrAbs.replace(timeTimeRegex, '')
        matchedAbsTime = true
    } else {
        match = tempStrAbs.match(hourOnlyRegex)
        if (match) {
            hour = parseInt(match[1])
            minute = 0
            tempStrAbs = tempStrAbs.replace(hourOnlyRegex, '')
            matchedAbsTime = true
        }
    }

    if (matchedAbsTime && hour !== null) {
        const suffixRegex = /^(?:am|pm|pagi|siang|sore|malam|morning|afternoon|evening|night|wib|wita|wit)\b\s*/i
        let suffix = null
        const suffixMatch = tempStrAbs.match(suffixRegex)
        if (suffixMatch) {
            suffix = suffixMatch[0].trim().toLowerCase()
            tempStrAbs = tempStrAbs.replace(suffixRegex, '')
        }

        const period = suffix || dayPeriod

        if (period === 'pm') {
            if (hour < 12) hour += 12
        } else if (period === 'am') {
            if (hour === 12) hour = 0
        } else if (['sore', 'malam', 'evening', 'night'].includes(period)) {
            if (hour < 12) hour += 12
        } else if (['pagi', 'morning'].includes(period)) {
            if (hour === 12) hour = 0
        } else if (['siang', 'afternoon'].includes(period)) {
            if (hour >= 1 && hour <= 5) hour += 12
        }

        const now = Date.now()
        const nowTz = getNowInTz()

        if (!period && hour < 12) {
            const tsAm = targetTzToMs(nowTz.year, nowTz.month, nowTz.day, hour, minute, 0)
            const tsPm = targetTzToMs(nowTz.year, nowTz.month, nowTz.day, hour + 12, minute, 0)

            if (tsAm <= now && tsPm > now) {
                hour += 12
            } else if (tsAm > now && tsPm > now) {
                if (tsPm - now < tsAm - now) {
                    hour += 12
                }
            }
        }

        let targetTs = targetTzToMs(nowTz.year, nowTz.month, nowTz.day, hour, minute, 0)
        
        if (dayOffset > 0) {
            targetTs += dayOffset * 86400000
        } else {
            if (targetTs <= now) {
                targetTs += 86400000
            }
        }

        const diffMs = targetTs - now
        if (diffMs > 0) {
            return {
                timeMs: diffMs,
                message: cleanMessage(tempStrAbs)
            }
        }
    }

    return null
}

function formatMs(ms) {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    const d = Math.floor(h / 24)

    if (d > 0) return `${d} hari ${h % 24 > 0 ? (h % 24) + ' jam' : ''}`.trim()
    if (h > 0) return `${h} jam ${m % 60 > 0 ? (m % 60) + ' menit' : ''}`.trim()
    if (m > 0) return `${m} menit`
    return `${s} detik`
}

const TZ = process.env.BOT_TIMEZONE ?? 'Asia/Jakarta'

function formatDate(unixTs) {
    return new Date(unixTs * 1000).toLocaleString('id-ID', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: TZ
    })
}

// ─────────────────────────────────────────────
// SCHEDULER
// ─────────────────────────────────────────────

let _sock = null
let _schedulerStarted = false

export function initReminderScheduler(sock) {
    if (_schedulerStarted) return
    _schedulerStarted = true
    _sock = sock

    logger.info('Reminder scheduler started')

    setInterval(async () => {
        try {
            const db = getDb()
            const now = Math.floor(Date.now() / 1000)
            const due = db.prepare(`
                SELECT * FROM reminders
                WHERE fire_at <= ? AND fired = 0
                ORDER BY fire_at ASC LIMIT 20
            `).all(now)

            for (const reminder of due) {
                try {
                    logger.info(`[Reminder] Firing #${reminder.id} → ${reminder.chat_id}`)

                    // triggerAlarm sudah handle react spam sendiri
                    await triggerAlarm(_sock, reminder.chat_id, reminder.message, false, reminder.quoted_msg)

                    db.prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(reminder.id)
                } catch (e) {
                    logger.error(`[Reminder] Fire error #${reminder.id}:`, e.message)
                }
            }
        } catch (e) {
            logger.error('[Reminder] Scheduler tick error:', e.message)
        }
    }, 30_000)
}

// ─────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────

export default {
    name: 'remindme',
    aliases: ['remind', 'ingatkan', 'alarm', 'r', 'rme'],
    category: 'general',
    description: 'Set reminder — bot akan ping kamu tepat waktu.',
    usage: '.remindme <waktu> <pesan>',
    example: '.remindme 30m Minum obat | .remindme besok jam 9 Meeting | .remindme 5/06/2026 15:00',
    cooldown: 2,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, sender, chatId, sock, messageContent } = ctx
        initReminderScheduler(sock)

        const db = getDb()
        const sub = args[0]?.toLowerCase()

        // ── !remindme list ────────────────────────────
        if (!args.length || sub === 'list' || sub === 'ls') {
            const reminders = db.prepare(`
                SELECT * FROM reminders
                WHERE user_jid = ? AND fired = 0
                ORDER BY fire_at ASC LIMIT 10
            `).all(sender)

            if (!reminders.length) {
                return reply(
                    `⏰ *Tidak ada reminder aktif.*\n\n` +
                    `Set reminder:\n` +
                    `• *!remindme 30m minum obat*\n` +
                    `• *!remindme 2h meeting*\n` +
                    `• *!remindme besok jam 9 sidang*\n` +
                    `• *!remindme 5/06/2026 15:00 bayar pajak*`
                )
            }

            const list = reminders.map((r, i) => {
                const remaining = r.fire_at - Math.floor(Date.now() / 1000)
                const eta = remaining > 0 ? `dalam ${formatMs(remaining * 1000)}` : 'segera'
                return `${i + 1}. 🔔 [#${r.id}] *${r.message}*\n   📅 ${formatDate(r.fire_at)} _(${eta})_`
            }).join('\n\n')

            return reply(
                `⏰ *Reminder aktif (${reminders.length}):*\n\n` +
                `${list}\n\n` +
                `_Hapus: !remindme delete <id>_`
            )
        }

        // ── !remindme delete <id> ─────────────────────
        if (['delete', 'del', 'cancel', 'hapus'].includes(sub)) {
            const id = parseInt(args[1])
            if (!id) return reply(`❌ Kasih ID reminder.\nContoh: !remindme delete 2`)

            const r = db.prepare('SELECT id, message FROM reminders WHERE id = ? AND user_jid = ? AND fired = 0').get(id, sender)
            if (!r) return reply(`❌ Reminder #${id} tidak ditemukan atau sudah selesai.`)

            db.prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(id)
            await react('✅')
            return reply(`✅ Reminder #${id} *"${r.message}"* dibatalkan.`)
        }

        // ── !remindme <waktu> <pesan> ─────────────────
        const parsed = parseReminder(args.join(' '))
        if (!parsed) {
            return reply(
                `❌ Format waktu tidak dikenali.\n\n` +
                `*Format yang didukung:*\n` +
                `• \`!remindme 30m minum obat\`\n` +
                `• \`!remindme besok jam 9 pagi meeting\`\n` +
                `• \`!remindme 5/06/2026 15:00 bayar tagihan\``
            )
        }

        let { timeMs, message: reminderMsg } = parsed
        
        // Cek Quoted Message (pesan yang di-reply)
        const quotedMsg = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage
        const serializedQuoted = quotedMsg ? JSON.stringify(quotedMsg) : null

        if (!reminderMsg && quotedMsg) reminderMsg = "(Membalas pesan)"
        if (!reminderMsg) return reply(`❌ Pesan remindernya mana?\nContoh: !remindme 30m minum obat`)

        const MIN_MS = 10_000
        const MAX_MS = 1825 * 86_400_000 // up to 5 years

        if (timeMs < MIN_MS) return reply(`❌ Minimal 10 detik.`)
        if (timeMs > MAX_MS) return reply(`❌ Maksimal 5 tahun.`)

        const activeCount = db.prepare('SELECT COUNT(*) as n FROM reminders WHERE user_jid = ? AND fired = 0').get(sender)?.n ?? 0
        if (activeCount >= 10) return reply(`⚠️ Sudah ada 10 reminder aktif. Hapus dulu: !remindme delete <id>`)

        const fireAt = Math.floor((Date.now() + timeMs) / 1000)

        db.prepare(`
            INSERT INTO reminders (user_jid, chat_id, message, fire_at, quoted_msg)
            VALUES (?, ?, ?, ?, ?)
        `).run(sender, chatId, reminderMsg, fireAt, serializedQuoted)

        await react('⏰')
        return reply(
            `⏰ *Reminder diset!*\n\n` +
            `📌 *${reminderMsg}*\n` +
            `🕐 ${formatDate(fireAt)}\n` +
            `⏳ dalam *${formatMs(timeMs)}*\n\n` +
            `_Bot akan ping kamu saat waktunya tiba 🔔_`
        )
    }
}