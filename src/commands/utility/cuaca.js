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

function findClosestHourlyIndex(hourlyTimes, currentTimeStr) {
    if (!hourlyTimes || !currentTimeStr) return -1
    const currentEpoch = new Date(currentTimeStr).getTime()
    let closestIndex = -1
    let minDiff = Infinity
    for (let i = 0; i < hourlyTimes.length; i++) {
        const t = new Date(hourlyTimes[i]).getTime()
        const diff = Math.abs(t - currentEpoch)
        if (diff < minDiff) {
            minDiff = diff
            closestIndex = i
        }
    }
    return closestIndex
}

export async function getDetailedWeatherReportOpenMeteo(city) {
    // Step 1: Geocoding — nama kota → koordinat (Open-Meteo Geocoding API, free)
    const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=id&format=json`
    )
    if (!geoRes.ok) {
        throw new Error(`Server Geocoding (Open-Meteo) sedang bermasalah (Status ${geoRes.status}). Silakan coba beberapa saat lagi.`)
    }
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
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,visibility,pressure_msl,cloud_cover` +
        `&hourly=temperature_2m,weather_code,precipitation_probability,uv_index` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,sunrise,sunset,uv_index_max` +
        `&timezone=auto&forecast_days=3`
    )
    if (!weatherRes.ok) {
        throw new Error(`Server Prakiraan Cuaca (Open-Meteo) sedang bermasalah (Status ${weatherRes.status}). Silakan coba beberapa saat lagi.`)
    }
    const wData = await weatherRes.json()
    const forecasts = Array.isArray(wData) ? wData : [wData]
    const mainForecast = forecasts[0]
    const c = mainForecast.current

    // Fetch Air Quality for the main location
    let aqiText = ''
    try {
        const aqRes = await fetch(
            `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi,pm2_5,pm10&timezone=auto`
        )
        const aqData = await aqRes.json()
        const aq = aqData?.current
        if (aq) {
            const aqi = aq.us_aqi
            let aqiDesc = 'Tidak diketahui'
            let aqiEmoji = '⚪'
            if (aqi <= 50) { aqiDesc = 'Baik'; aqiEmoji = '🟢' }
            else if (aqi <= 100) { aqiDesc = 'Sedang'; aqiEmoji = '🟡' }
            else if (aqi <= 150) { aqiDesc = 'Tidak Sehat (Sensitif)'; aqiEmoji = '🟠' }
            else if (aqi <= 200) { aqiDesc = 'Tidak Sehat'; aqiEmoji = '🔴' }
            else if (aqi <= 300) { aqiDesc = 'Sangat Tidak Sehat'; aqiEmoji = '🟣' }
            else if (aqi > 300) { aqiDesc = 'Berbahaya'; aqiEmoji = '🟤' }

            aqiText = `\n🍃 *Kualitas Udara (AQI):* ${aqi} (${aqiDesc}) ${aqiEmoji}\n` +
                      `   - PM2.5: ${aq.pm2_5} µg/m³\n` +
                      `   - PM10: ${aq.pm10} µg/m³`
        }
    } catch (err) {
        logger.error('❌ [Weather] AQI Error:', err.message)
    }

    const [emoji, desc] = weatherDesc(c.weather_code)
    const locationStr = [name, admin1, country].filter(Boolean).join(', ')

    // Format sunrise & sunset
    const formatTimeStr = (isoStr) => {
        if (!isoStr) return '-'
        const parts = isoStr.split('T')
        if (parts.length < 2) return '-'
        return parts[1]
    }
    const sunrise = formatTimeStr(mainForecast.daily.sunrise?.[0])
    const sunset = formatTimeStr(mainForecast.daily.sunset?.[0])

    // Format UV Index
    const uv = mainForecast.daily.uv_index_max?.[0] ?? 0
    let uvDesc = 'Rendah'
    let uvEmoji = '🟢'
    if (uv <= 2) { uvDesc = 'Rendah'; uvEmoji = '🟢' }
    else if (uv <= 5) { uvDesc = 'Sedang'; uvEmoji = '🟡' }
    else if (uv <= 7) { uvDesc = 'Tinggi'; uvEmoji = '🟠' }
    else if (uv <= 10) { uvDesc = 'Sangat Tinggi'; uvEmoji = '🔴' }
    else { uvDesc = 'Ekstrem'; uvEmoji = '🟣' }

    let text = ''
    if (isMedan) {
        text += `🌤️ *Laporan Cuaca Detail Kota ${name} & Sekitarnya*\n`
        text += `${admin1 ? admin1 + ', ' : ''}${country}\n\n`
        text += `🌡️ Suhu Pusat Kota: *${c.temperature_2m}°C* (terasa seperti ${c.apparent_temperature}°C)\n`
        text += `📋 Kondisi: ${emoji} ${desc}\n`
        text += `☁️ Tutupan Awan: ${c.cloud_cover}%\n`
        text += `💧 Kelembaban: ${c.relative_humidity_2m}%\n`
        text += `💨 Angin: ${c.wind_speed_10m} km/h arah ${windDir(c.wind_direction_10m)}\n`
        text += `👁️ Jarak Pandang: ${(c.visibility / 1000).toFixed(1)} km\n`
        text += `🎈 Tekanan Udara: ${c.pressure_msl} hPa\n`
        text += `☀️ Indeks UV Maks: ${uv} (${uvDesc}) ${uvEmoji}\n`
        text += `🌅 Sunrise: ${sunrise} | 🌇 Sunset: ${sunset}\n`
        text += `${aqiText}\n\n`

        // hourly forecast for next few hours
        const currentHourStr = c.time
        if (mainForecast.hourly) {
            const currentIndex = findClosestHourlyIndex(mainForecast.hourly.time, currentHourStr)
            if (currentIndex !== -1) {
                const nextHours = []
                for (let offset = 1; offset <= 4; offset++) {
                    const idx = currentIndex + offset * 2 // check every 2 hours (+2h, +4h, +6h, +8h)
                    if (idx < mainForecast.hourly.time.length) {
                        const timeVal = mainForecast.hourly.time[idx]
                        const tempVal = mainForecast.hourly.temperature_2m[idx]
                        const codeVal = mainForecast.hourly.weather_code[idx]
                        const probVal = mainForecast.hourly.precipitation_probability ? mainForecast.hourly.precipitation_probability[idx] : null
                        const uvHourVal = mainForecast.hourly.uv_index ? mainForecast.hourly.uv_index[idx] : null
                        
                        const timeFormatted = timeVal.split('T')[1]
                        const [emo, dsc] = weatherDesc(codeVal)
                        
                        let item = `• *${timeFormatted}:* ${tempVal}°C | ${emo} ${dsc}`
                        if (probVal !== null && probVal > 0) {
                            item += ` (🌧️ ${probVal}%)`
                        }
                        if (uvHourVal !== null && uvHourVal > 0) {
                            item += ` (UV: ${uvHourVal})`
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
        text += `${emoji} *Laporan Cuaca Detail: ${locationStr}*\n\n`
        text += `🌡️ Suhu: *${c.temperature_2m}°C* (terasa seperti ${c.apparent_temperature}°C)\n`
        text += `📋 Kondisi: ${desc}\n`
        text += `☁️ Tutupan Awan: ${c.cloud_cover}%\n`
        text += `💧 Kelembaban: ${c.relative_humidity_2m}%\n`
        text += `💨 Angin: ${c.wind_speed_10m} km/h arah ${windDir(c.wind_direction_10m)}\n`
        text += `👁️ Jarak Pandang: ${(c.visibility / 1000).toFixed(1)} km\n`
        text += `🎈 Tekanan Udara: ${c.pressure_msl} hPa\n`
        text += `☀️ Indeks UV Maks: ${uv} (${uvDesc}) ${uvEmoji}\n`
        text += `🌅 Sunrise: ${sunrise} | 🌇 Sunset: ${sunset}\n`
        text += `${aqiText}\n\n`

        // hourly forecast for next few hours
        const currentHourStr = c.time
        if (mainForecast.hourly) {
            const currentIndex = findClosestHourlyIndex(mainForecast.hourly.time, currentHourStr)
            if (currentIndex !== -1) {
                const nextHours = []
                for (let offset = 1; offset <= 4; offset++) {
                    const idx = currentIndex + offset * 2 // check every 2 hours (+2h, +4h, +6h, +8h)
                    if (idx < mainForecast.hourly.time.length) {
                        const timeVal = mainForecast.hourly.time[idx]
                        const tempVal = mainForecast.hourly.temperature_2m[idx]
                        const codeVal = mainForecast.hourly.weather_code[idx]
                        const probVal = mainForecast.hourly.precipitation_probability ? mainForecast.hourly.precipitation_probability[idx] : null
                        const uvHourVal = mainForecast.hourly.uv_index ? mainForecast.hourly.uv_index[idx] : null
                        
                        const timeFormatted = timeVal.split('T')[1]
                        const [emo, dsc] = weatherDesc(codeVal)
                        
                        let item = `• *${timeFormatted}:* ${tempVal}°C | ${emo} ${dsc}`
                        if (probVal !== null && probVal > 0) {
                            item += ` (🌧️ ${probVal}%)`
                        }
                        if (uvHourVal !== null && uvHourVal > 0) {
                            item += ` (UV: ${uvHourVal})`
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

const weatherApiDescMap = {
    1000: ['☀️', 'Cerah'],
    1003: ['⛅', 'Berawan Sebagian'],
    1006: ['☁️', 'Berawan'],
    1009: ['☁️', 'Mendung'],
    1030: ['🌫️', 'Kabut Tipis'],
    1063: ['🌦️', 'Kemungkinan Hujan'],
    1066: ['🌨️', 'Kemungkinan Salju'],
    1069: ['🌨️', 'Kemungkinan Hujan Es'],
    1072: ['🌦️', 'Kemungkinan Gerimis Beku'],
    1087: ['⛈️', 'Kemungkinan Badai Petir'],
    1114: ['🌨️', 'Badai Salju Tiup'],
    1117: ['🌨️', 'Badai Salju Lebat'],
    1135: ['🌫️', 'Berkabut'],
    1147: ['🌫️', 'Kabut Membeku'],
    1150: ['🌦️', 'Gerimis Ringan Tidak Merata'],
    1153: ['🌦️', 'Gerimis Ringan'],
    1168: ['🌦️', 'Gerimis Beku Ringan'],
    1171: ['🌦️', 'Gerimis Beku Lebat'],
    1180: ['🌧️', 'Hujan Ringan Tidak Merata'],
    1183: ['🌧️', 'Hujan Ringan'],
    1186: ['🌧️', 'Hujan Sedang Kadang-kadang'],
    1189: ['🌧️', 'Hujan Sedang'],
    1192: ['🌧️', 'Hujan Lebat Kadang-kadang'],
    1195: ['🌧️', 'Hujan Lebat'],
    1198: ['🌧️', 'Hujan Beku Ringan'],
    1201: ['🌧️', 'Hujan Beku Sedang/Lebat'],
    1204: ['🌨️', 'Sleet Ringan'],
    1207: ['🌨️', 'Sleet Sedang/Lebat'],
    1210: ['🌨️', 'Salju Ringan Tidak Merata'],
    1213: ['🌨️', 'Salju Ringan'],
    1216: ['🌨️', 'Salju Sedang Tidak Merata'],
    1219: ['🌨️', 'Salju Sedang'],
    1222: ['🌨️', 'Salju Lebat Tidak Merata'],
    1225: ['🌨️', 'Salju Lebat'],
    1237: ['🌨️', 'Pelet Es'],
    1240: ['🌧️', 'Hujan Rintik Ringan'],
    1243: ['🌧️', 'Hujan Rintik Sedang/Lebat'],
    1246: ['🌧️', 'Hujan Rintik Sangat Lebat'],
    1249: ['🌨️', 'Sleet Ringan Rintik'],
    1252: ['🌨️', 'Sleet Sedang/Lebat Rintik'],
    1255: ['🌨️', 'Salju Ringan Rintik'],
    1258: ['🌨️', 'Salju Sedang/Lebat Rintik'],
    1261: ['🌨️', 'Pelet Es Ringan Rintik'],
    1264: ['🌨️', 'Pelet Es Sedang/Lebat Rintik'],
    1273: ['⛈️', 'Hujan Ringan Disertai Petir'],
    1276: ['⛈️', 'Hujan Lebat Disertai Petir'],
    1279: ['⛈️', 'Salju Ringan Disertai Petir'],
    1282: ['⛈️', 'Salju Lebat Disertai Petir']
}

function getWeatherApiDesc(code) {
    return weatherApiDescMap[code] ?? ['🌡️', 'Tidak Diketahui']
}

function translateWindDir(dir) {
    if (!dir) return 'U'
    dir = dir.toUpperCase()
    if (dir.includes('N') && dir.includes('E')) return 'TL'
    if (dir.includes('S') && dir.includes('E')) return 'TG'
    if (dir.includes('S') && dir.includes('W')) return 'BD'
    if (dir.includes('N') && dir.includes('W')) return 'BL'
    if (dir === 'N') return 'U'
    if (dir === 'E') return 'T'
    if (dir === 'S') return 'S'
    if (dir === 'W') return 'B'
    return dir
}

function convertTo24h(timeStr) {
    if (!timeStr) return '-'
    const match = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i)
    if (!match) return timeStr
    let hours = parseInt(match[1], 10)
    const minutes = match[2]
    const ampm = match[3].toUpperCase()
    if (ampm === 'PM' && hours < 12) hours += 12
    if (ampm === 'AM' && hours === 12) hours = 0
    return `${String(hours).padStart(2, '0')}:${minutes}`
}

export async function getDetailedWeatherReportFallback(city) {
    const apiKey = process.env.WEATHER_API_KEY
    if (!apiKey) {
        throw new Error('WEATHER_API_KEY tidak dikonfigurasi di file .env')
    }

    const isMedan = city.toLowerCase() === 'medan'

    const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(city)}&days=3&aqi=yes`
    const res = await fetch(url)
    if (!res.ok) {
        throw new Error(`WeatherAPI returning error status ${res.status}`)
    }
    const data = await res.json()

    const { name, region, country } = data.location
    const c = data.current
    
    const [emoji, desc] = getWeatherApiDesc(c.condition.code)
    const locationStr = [name, region, country].filter(Boolean).join(', ')

    const fday0 = data.forecast.forecastday[0]
    const sunrise = convertTo24h(fday0.astro.sunrise)
    const sunset = convertTo24h(fday0.astro.sunset)

    const uv = fday0.day.uv ?? 0
    let uvDesc = 'Rendah'
    let uvEmoji = '🟢'
    if (uv <= 2) { uvDesc = 'Rendah'; uvEmoji = '🟢' }
    else if (uv <= 5) { uvDesc = 'Sedang'; uvEmoji = '🟡' }
    else if (uv <= 7) { uvDesc = 'Tinggi'; uvEmoji = '🟠' }
    else if (uv <= 10) { uvDesc = 'Sangat Tinggi'; uvEmoji = '🔴' }
    else { uvDesc = 'Ekstrem'; uvEmoji = '🟣' }

    let aqiText = ''
    if (c.air_quality) {
        const aq = c.air_quality
        const epaIndex = aq['us-epa-index'] ?? 1
        let aqiDesc = 'Baik'
        let aqiEmoji = '🟢'
        if (epaIndex === 1) { aqiDesc = 'Baik'; aqiEmoji = '🟢' }
        else if (epaIndex === 2) { aqiDesc = 'Sedang'; aqiEmoji = '🟡' }
        else if (epaIndex === 3) { aqiDesc = 'Tidak Sehat (Sensitif)'; aqiEmoji = '🟠' }
        else if (epaIndex === 4) { aqiDesc = 'Tidak Sehat'; aqiEmoji = '🔴' }
        else if (epaIndex === 5) { aqiDesc = 'Sangat Tidak Sehat'; aqiEmoji = '🟣' }
        else if (epaIndex >= 6) { aqiDesc = 'Berbahaya'; aqiEmoji = '🟤' }

        aqiText = `\n🍃 *Kualitas Udara (EPA Index):* Level ${epaIndex} (${aqiDesc}) ${aqiEmoji}\n` +
                  `   - PM2.5: ${aq.pm2_5 ? aq.pm2_5.toFixed(1) : '-'} µg/m³\n` +
                  `   - PM10: ${aq.pm10 ? aq.pm10.toFixed(1) : '-'} µg/m³`
    }

    let text = ''
    if (isMedan) {
        text += `🌤️ *Laporan Cuaca Detail Kota ${name} & Sekitarnya*\n`
        text += `${region ? region + ', ' : ''}${country}\n\n`
        text += `🌡️ Suhu Pusat Kota: *${c.temp_c}°C* (terasa seperti ${c.feelslike_c}°C)\n`
        text += `📋 Kondisi: ${emoji} ${desc}\n`
        text += `☁️ Tutupan Awan: ${c.cloud}%\n`
        text += `💧 Kelembaban: ${c.humidity}%\n`
        text += `💨 Angin: ${c.wind_kph} km/h arah ${translateWindDir(c.wind_dir)}\n`
        text += `👁️ Jarak Pandang: ${c.vis_km.toFixed(1)} km\n`
        text += `🎈 Tekanan Udara: ${c.pressure_mb} hPa\n`
        text += `☀️ Indeks UV Maks: ${uv} (${uvDesc}) ${uvEmoji}\n`
        text += `🌅 Sunrise: ${sunrise} | 🌇 Sunset: ${sunset}\n`
        text += `${aqiText}\n\n`

        const allHours = []
        for (const day of data.forecast.forecastday) {
            if (day.hour) allHours.push(...day.hour)
        }

        const currentEpoch = data.location.localtime_epoch * 1000
        let currentIndex = -1
        let minDiff = Infinity
        for (let i = 0; i < allHours.length; i++) {
            const t = allHours[i].time_epoch * 1000
            const diff = Math.abs(t - currentEpoch)
            if (diff < minDiff) {
                minDiff = diff
                currentIndex = i
            }
        }

        if (currentIndex !== -1) {
            const nextHours = []
            for (let offset = 1; offset <= 4; offset++) {
                const idx = currentIndex + offset * 2
                if (idx < allHours.length) {
                    const hourData = allHours[idx]
                    const timeVal = hourData.time
                    const tempVal = hourData.temp_c
                    const codeVal = hourData.condition.code
                    const probVal = hourData.chance_of_rain
                    const uvHourVal = hourData.uv

                    const timeFormatted = timeVal.split(' ')[1]
                    const [emo, dsc] = getWeatherApiDesc(codeVal)

                    let item = `• *${timeFormatted}:* ${tempVal}°C | ${emo} ${dsc}`
                    if (probVal > 0) {
                        item += ` (🌧️ ${probVal}%)`
                    }
                    if (uvHourVal > 0) {
                        item += ` (UV: ${uvHourVal})`
                    }
                    nextHours.push(item)
                }
            }
            if (nextHours.length > 0) {
                text += `⏰ *Prakiraan Waktu Terdekat (Pusat Kota):*\n` + nextHours.join('\n') + `\n\n`
            }
        }

        const subDistricts = [
            { name: 'Padang Bulan', latitude: 3.5518, longitude: 98.6473, icon: '🏢' },
            { name: 'Medan Johor', latitude: 3.5323, longitude: 98.6749, icon: '🏡' },
            { name: 'Medan Menteng', latitude: 3.5658, longitude: 98.7176, icon: '🏬' },
            { name: 'Medan Baru', latitude: 3.5701, longitude: 98.6593, icon: '🎓' },
            { name: 'Medan Petisah', latitude: 3.5932, longitude: 98.6653, icon: '🛍️' },
            { name: 'Medan Belawan', latitude: 3.7845, longitude: 98.6795, icon: '🚢' },
            { name: 'Medan Helvetia', latitude: 3.6062, longitude: 98.6417, icon: '🍃' }
        ]

        const subPromises = subDistricts.map(async dist => {
            try {
                const sres = await fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${dist.latitude},${dist.longitude}`)
                if (!sres.ok) return null
                return await sres.json()
            } catch {
                return null
            }
        })
        const subResults = await Promise.all(subPromises)

        text += `📍 *Kondisi Wilayah Medan:*\n`
        for (let i = 0; i < subDistricts.length; i++) {
            const dist = subDistricts[i]
            const curData = subResults[i]
            if (curData?.current) {
                const cur = curData.current
                const [emo, dsc] = getWeatherApiDesc(cur.condition.code)
                text += `• ${dist.icon} *${dist.name}:* ${cur.temp_c}°C | ${emo} ${dsc}\n`
            }
        }

        text += `\n📅 *Prakiraan 3 Hari (Medan):*\n`
    } else {
        text += `${emoji} *Laporan Cuaca Detail: ${locationStr}*\n\n`
        text += `🌡️ Suhu: *${c.temp_c}°C* (terasa seperti ${c.feelslike_c}°C)\n`
        text += `📋 Kondisi: ${desc}\n`
        text += `☁️ Tutupan Awan: ${c.cloud}%\n`
        text += `💧 Kelembaban: ${c.humidity}%\n`
        text += `💨 Angin: ${c.wind_kph} km/h arah ${translateWindDir(c.wind_dir)}\n`
        text += `👁️ Jarak Pandang: ${c.vis_km.toFixed(1)} km\n`
        text += `🎈 Tekanan Udara: ${c.pressure_mb} hPa\n`
        text += `☀️ Indeks UV Maks: ${uv} (${uvDesc}) ${uvEmoji}\n`
        text += `🌅 Sunrise: ${sunrise} | 🌇 Sunset: ${sunset}\n`
        text += `${aqiText}\n\n`

        const allHours = []
        for (const day of data.forecast.forecastday) {
            if (day.hour) allHours.push(...day.hour)
        }

        const currentEpoch = data.location.localtime_epoch * 1000
        let currentIndex = -1
        let minDiff = Infinity
        for (let i = 0; i < allHours.length; i++) {
            const t = allHours[i].time_epoch * 1000
            const diff = Math.abs(t - currentEpoch)
            if (diff < minDiff) {
                minDiff = diff
                currentIndex = i
            }
        }

        if (currentIndex !== -1) {
            const nextHours = []
            for (let offset = 1; offset <= 4; offset++) {
                const idx = currentIndex + offset * 2
                if (idx < allHours.length) {
                    const hourData = allHours[idx]
                    const timeVal = hourData.time
                    const tempVal = hourData.temp_c
                    const codeVal = hourData.condition.code
                    const probVal = hourData.chance_of_rain
                    const uvHourVal = hourData.uv

                    const timeFormatted = timeVal.split(' ')[1]
                    const [emo, dsc] = getWeatherApiDesc(codeVal)

                    let item = `• *${timeFormatted}:* ${tempVal}°C | ${emo} ${dsc}`
                    if (probVal > 0) {
                        item += ` (🌧️ ${probVal}%)`
                    }
                    if (uvHourVal > 0) {
                        item += ` (UV: ${uvHourVal})`
                    }
                    nextHours.push(item)
                }
            }
            if (nextHours.length > 0) {
                text += `⏰ *Prakiraan Waktu Terdekat:*\n` + nextHours.join('\n') + `\n\n`
            }
        }

        text += `📅 *Prakiraan 3 Hari:*\n`
    }

    const days = ['Hari ini', 'Besok', 'Lusa']
    for (let i = 0; i < Math.min(3, data.forecast.forecastday.length); i++) {
        const fday = data.forecast.forecastday[i]
        const [de, dd] = getWeatherApiDesc(fday.day.condition.code)
        text += `${de} *${days[i]}:* ${fday.day.mintemp_c.toFixed(0)}°–${fday.day.maxtemp_c.toFixed(0)}°C, ${dd}`
        if (fday.day.totalprecip_mm > 0) text += `, hujan ${fday.day.totalprecip_mm}mm`
        text += '\n'
    }

    return text.trim()
}

export async function getDetailedWeatherReport(city) {
    try {
        const report = await getDetailedWeatherReportOpenMeteo(city)
        return report + `\n\n⚡ *Sumber:* Open-Meteo API`
    } catch (err) {
        logger.warn(`[Weather] Open-Meteo error: ${err.message}. Trying WeatherAPI fallback...`)
        try {
            const report = await getDetailedWeatherReportFallback(city)
            return report + `\n\n⚡ *Sumber:* WeatherAPI.com (Fallback)`
        } catch (fallbackErr) {
            logger.error(`[Weather] Both Open-Meteo and WeatherAPI failed.`)
            throw new Error(`Semua server cuaca sedang bermasalah.\n- Open-Meteo: ${err.message}\n- WeatherAPI: ${fallbackErr.message}`)
        }
    }
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
    usage: '.cuaca [kota] | subscribe [kota] | unsubscribe',
    example: '.cuaca Medan\n!cuaca subscribe Medan\n!cuaca unsubscribe',
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