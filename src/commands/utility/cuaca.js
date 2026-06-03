// src/commands/utility/cuaca.js
// !cuaca — Realtime weather via Open-Meteo (no API key!) + geocoding
// Mendukung prakiraan per jam terdekat & langganan laporan cuaca harian otomatis setiap tengah malam (00:00)

import Database from 'better-sqlite3'
import path from 'path'
import { logger } from '../../utils/logger.js'

const DB_PATH = path.resolve(process.env.DB_PATH ?? './storage/database/main.db')

function getDb() {
    const db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.exec(`
        CREATE TABLE IF NOT EXISTS weather_subscriptions (
            chat_id TEXT PRIMARY KEY,
            city TEXT NOT NULL DEFAULT 'Medan',
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
    `)
    return db
}

// WMO Weather Code → deskripsi + emoji
export const weatherDesc = (code) => {
    if (code === 0) return ['☀️', 'Cerah']
    if (code <= 2) return ['⛅', 'Berawan sebagian']
    if (code === 3) return ['☁️', 'Mendung']
    if (code <= 49) return ['🌫️', 'Berkabut']
    if (code <= 59) return ['🌦️', 'Gerimis']
    if (code <= 69) return ['🌧️', 'Hujan']
    if (code <= 79) return ['🌨️', 'Salju']
    if (code <= 84) return ['🌧️', 'Hujan lebat']
    if (code <= 99) return ['⛈️', 'Badai petir']
    return ['🌡️', 'Tidak diketahui']
}

export const windDir = (deg) => {
    const dirs = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL']
    return dirs[Math.round(deg / 45) % 8]
}

export async function getDetailedWeatherReport(city) {
    // Step 1: Geocoding — nama kota → koordinat (Open-Meteo Geocoding API, free)
    const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=id&format=json`
    )
    const geoData = await geoRes.json()
    const location = geoData?.results?.[0]
    if (!location) throw new Error(`Kota/Wilayah *${city}* tidak ditemukan. Coba nama yang lebih spesifik.`)

    const { latitude, longitude, name, country, admin1 } = location
    const isMedan = name.toLowerCase() === 'medan' || city.toLowerCase() === 'medan'

    const subDistricts = [
        { name: 'Padang Bulan', latitude: 3.5518, longitude: 98.6473, icon: '🏢' },
        { name: 'Medan Johor', latitude: 3.5323, longitude: 98.6749, icon: '🏡' },
        { name: 'Medan Menteng', latitude: 3.5658, longitude: 98.7176, icon: '🏬' },
        { name: 'Medan Baru', latitude: 3.5701, longitude: 98.6593, icon: '🎓' },
        { name: 'Medan Petisah', latitude: 3.5932, longitude: 98.6653, icon: '🛍️' },
        { name: 'Medan Belawan', latitude: 3.7845, longitude: 98.6795, icon: '🚢' },
        { name: 'Medan Helvetia', latitude: 3.6062, longitude: 98.6417, icon: '🍃' }
    ]

    let lats = [latitude]
    let lons = [longitude]

    if (isMedan) {
        lats.push(...subDistricts.map(d => d.latitude))
        lons.push(...subDistricts.map(d => d.longitude))
    }

    // Step 2: Weather data (Open-Meteo, free, no key)
    const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?` +
        `latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
        `&hourly=temperature_2m,weather_code,precipitation_probability` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
        `&timezone=auto&forecast_days=3`
    )
    const wData = await weatherRes.json()
    const forecasts = Array.isArray(wData) ? wData : [wData]
    const mainForecast = forecasts[0]
    const c = mainForecast.current

    const [emoji, desc] = weatherDesc(c.weather_code)
    const locationStr = [name, admin1, country].filter(Boolean).join(', ')

    let text = ''
    if (isMedan) {
        text += `🌤️ *Laporan Cuaca Kota ${name} & Sekitarnya*\n`
        text += `${admin1 ? admin1 + ', ' : ''}${country}\n\n`
        text += `🌡️ Suhu Pusat Kota: *${c.temperature_2m}°C* (terasa ${c.apparent_temperature}°C)\n`
        text += `💧 Kelembaban: ${c.relative_humidity_2m}%\n`
        text += `🌬️ Angin: ${c.wind_speed_10m} km/h arah ${windDir(c.wind_direction_10m)}\n`
        text += `🌧️ Hujan: ${c.precipitation} mm\n`
        text += `📋 Kondisi: ${desc}\n\n`

        // hourly forecast for next few hours
        const currentHourStr = c.time
        if (mainForecast.hourly) {
            const currentIndex = mainForecast.hourly.time.indexOf(currentHourStr)
            if (currentIndex !== -1) {
                const nextHours = []
                for (let offset = 1; offset <= 4; offset++) {
                    const idx = currentIndex + offset * 2 // check every 2 hours (+2h, +4h, +6h, +8h)
                    if (idx < mainForecast.hourly.time.length) {
                        const timeVal = mainForecast.hourly.time[idx]
                        const tempVal = mainForecast.hourly.temperature_2m[idx]
                        const codeVal = mainForecast.hourly.weather_code[idx]
                        const probVal = mainForecast.hourly.precipitation_probability ? mainForecast.hourly.precipitation_probability[idx] : null
                        
                        const timeFormatted = timeVal.split('T')[1]
                        const [emo, dsc] = weatherDesc(codeVal)
                        
                        let item = `• *${timeFormatted}:* ${tempVal}°C | ${emo} ${dsc}`
                        if (probVal !== null && probVal > 0) {
                            item += ` (🌧️ ${probVal}%)`
                        }
                        nextHours.push(item)
                    }
                }
                if (nextHours.length > 0) {
                    text += `⏰ *Prakiraan Waktu Terdekat (Pusat Kota):*\n` + nextHours.join('\n') + `\n\n`
                }
            }
        }

        text += `📍 *Kondisi Wilayah Medan:*\n`
        for (let i = 0; i < subDistricts.length; i++) {
            const dist = subDistricts[i]
            const fcast = forecasts[i + 1]
            if (fcast?.current) {
                const cur = fcast.current
                const [emo, dsc] = weatherDesc(cur.weather_code)
                text += `• ${dist.icon} *${dist.name}:* ${cur.temperature_2m}°C | ${emo} ${dsc}\n`
            }
        }
        
        text += `\n📅 *Prakiraan 3 Hari (Medan):*\n`
    } else {
        text += `${emoji} *Cuaca ${locationStr}*\n\n`
        text += `🌡️ Suhu: *${c.temperature_2m}°C* (terasa ${c.apparent_temperature}°C)\n`
        text += `💧 Kelembaban: ${c.relative_humidity_2m}%\n`
        text += `🌬️ Angin: ${c.wind_speed_10m} km/h arah ${windDir(c.wind_direction_10m)}\n`
        text += `🌧️ Hujan: ${c.precipitation} mm\n`
        text += `📋 Kondisi: ${desc}\n\n`

        // hourly forecast for next few hours
        const currentHourStr = c.time
        if (mainForecast.hourly) {
            const currentIndex = mainForecast.hourly.time.indexOf(currentHourStr)
            if (currentIndex !== -1) {
                const nextHours = []
                for (let offset = 1; offset <= 4; offset++) {
                    const idx = currentIndex + offset * 2 // check every 2 hours (+2h, +4h, +6h, +8h)
                    if (idx < mainForecast.hourly.time.length) {
                        const timeVal = mainForecast.hourly.time[idx]
                        const tempVal = mainForecast.hourly.temperature_2m[idx]
                        const codeVal = mainForecast.hourly.weather_code[idx]
                        const probVal = mainForecast.hourly.precipitation_probability ? mainForecast.hourly.precipitation_probability[idx] : null
                        
                        const timeFormatted = timeVal.split('T')[1]
                        const [emo, dsc] = weatherDesc(codeVal)
                        
                        let item = `• *${timeFormatted}:* ${tempVal}°C | ${emo} ${dsc}`
                        if (probVal !== null && probVal > 0) {
                            item += ` (🌧️ ${probVal}%)`
                        }
                        nextHours.push(item)
                    }
                }
                if (nextHours.length > 0) {
                    text += `⏰ *Prakiraan Waktu Terdekat:*\n` + nextHours.join('\n') + `\n\n`
                }
            }
        }

        text += `📅 *Prakiraan 3 Hari:*\n`
    }

    const days = ['Hari ini', 'Besok', 'Lusa']
    for (let i = 0; i < 3; i++) {
        const [de, dd] = weatherDesc(mainForecast.daily.weather_code[i])
        text += `${de} *${days[i]}:* ${mainForecast.daily.temperature_2m_min[i]}°–${mainForecast.daily.temperature_2m_max[i]}°C, ${dd}`
        if (mainForecast.daily.precipitation_sum[i] > 0) text += `, hujan ${mainForecast.daily.precipitation_sum[i]}mm`
        text += '\n'
    }

    return text.trim()
}

// ─────────────────────────────────────────────
// SCHEDULER
// ─────────────────────────────────────────────

let _sock = null
let _schedulerStarted = false

let _lastTriggerDay = -1

export function initWeatherScheduler(sock) {
    if (_schedulerStarted) return
    _schedulerStarted = true
    _sock = sock

    logger.info('Weather scheduler initialized')

    // Cek setiap 30 detik untuk memastikan kita tidak kelewatan menit 00
    setInterval(async () => {
        try {
            // Gunakan manual offset (GMT+7) untuk menghindari masalah Intl di Alpine Linux
            const offsetMs = 7 * 60 * 60 * 1000
            const nowJakarta = new Date(Date.now() + offsetMs)
            
            const hours = nowJakarta.getUTCHours()
            const minutes = nowJakarta.getUTCMinutes()
            const day = nowJakarta.getUTCDate()
            
            // Jam 00:00
            if (hours === 0 && minutes === 0) {
                // Pastikan hanya trigger 1x per hari
                if (_lastTriggerDay === day) return
                _lastTriggerDay = day

                const db = getDb()
                const subs = db.prepare('SELECT * FROM weather_subscriptions').all()
                if (subs.length === 0) return

                logger.info(`[Weather Scheduler] Running daily automatic reports for ${subs.length} chats...`)

                // Cache pencarian kota untuk meminimalkan hits API
                const weatherCache = new Map()

                for (const sub of subs) {
                    try {
                        let text = weatherCache.get(sub.city.toLowerCase())
                        if (!text) {
                            text = await getDetailedWeatherReport(sub.city)
                            weatherCache.set(sub.city.toLowerCase(), text)
                        }

                        await _sock.sendMessage(sub.chat_id, {
                            text: `🔔 *LAPORAN CUACA HARIAN OTOMATIS*\n\n${text}`
                        })
                    } catch (err) {
                        logger.error(`[Weather Scheduler] Gagal kirim laporan ke ${sub.chat_id}: ${err.message}`)
                    }
                }
            }
        } catch (err) {
            logger.error('[Weather Scheduler] Error in tick:', err.message)
        }
    }, 30_000)
}

// ─────────────────────────────────────────────
// COMMAND EXPORT
// ─────────────────────────────────────────────

export default {
    name: 'cuaca',
    aliases: ['weather'],
    category: 'utility',
    description: 'Cek cuaca realtime kota manapun, atau langganan laporan cuaca harian otomatis setiap 12 malam',
    usage: '!cuaca [kota] | subscribe [kota] | unsubscribe',
    example: '!cuaca Medan\n!cuaca subscribe Medan\n!cuaca unsubscribe',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react, chatId, sock } = ctx
        
        // Pastikan scheduler berjalan
        initWeatherScheduler(sock)

        const db = getDb()
        const commandArg = args[0]?.toLowerCase().trim()

        // ── 1. SUBSCRIBE / LANGGANAN ──
        if (commandArg === 'subscribe' || commandArg === 'sub' || commandArg === 'langganan') {
            let targetCity = args.slice(1).join(' ').trim()
            if (!targetCity) {
                targetCity = 'Medan'
            }

            await react('⏳')
            try {
                // Validasi kota dulu lewat API
                await getDetailedWeatherReport(targetCity)

                db.prepare(`
                    INSERT INTO weather_subscriptions (chat_id, city)
                    VALUES (?, ?)
                    ON CONFLICT(chat_id) DO UPDATE SET city = excluded.city
                `).run(chatId, targetCity)

                await react('✅')
                return reply(
                    `✅ *Berhasil Berlangganan!*\n\n` +
                    `Bot akan otomatis mengirimkan laporan cuaca detail untuk kota *${targetCity}* setiap hari pada jam *00:00 (Tengah Malam)* ke room chat ini.`
                )
            } catch (err) {
                await react('❌')
                return reply(`❌ Gagal mendaftar langganan: ${err.message}`)
            }
        }

        // ── 2. UNSUBSCRIBE / BATAL ──
        if (commandArg === 'unsubscribe' || commandArg === 'unsub' || commandArg === 'batal') {
            await react('⏳')
            try {
                const sub = db.prepare('SELECT city FROM weather_subscriptions WHERE chat_id = ?').get(chatId)
                if (!sub) {
                    await react('⚠️')
                    return reply(`⚠️ Room chat ini belum terdaftar dalam langganan cuaca harian.`)
                }

                db.prepare('DELETE FROM weather_subscriptions WHERE chat_id = ?').run(chatId)
                await react('✅')
                return reply(`✅ *Berhasil Berhenti Berlangganan!*\n\nLaporan cuaca otomatis untuk kota *${sub.city}* ke room chat ini telah dinonaktifkan.`)
            } catch (err) {
                await react('❌')
                return reply(`❌ Gagal membatalkan langganan: ${err.message}`)
            }
        }

        // ── 3. CEK CUACA STANDARD (DIRECT QUERY) ──
        let city = args.join(' ').trim()
        if (!city) {
            city = 'Medan'
        }

        await react('🌤️')

        try {
            const text = await getDetailedWeatherReport(city)
            await reply(text)
            await react('✅')
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal ambil data cuaca: ${err.message}`)
        }
    }
}