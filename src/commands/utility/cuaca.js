// src/commands/utility/cuaca.js
// !cuaca — Realtime weather via Open-Meteo (no API key!) + geocoding

export default {
    name: 'cuaca',
    aliases: ['weather', 'weather'],
    category: 'utility',
    description: 'Cek cuaca realtime di kota manapun',
    usage: '!cuaca [kota]',
    example: '!cuaca Medan',
    cooldown: 5,
    permissions: ['user'],

    async execute(ctx) {
        const { args, reply, react } = ctx
        
        let city = args.join(' ').trim()
        if (!city) {
            city = 'Medan'
        }

        await react('🌤️')

        try {
            // Step 1: Geocoding — nama kota → koordinat (Open-Meteo Geocoding API, free)
            const geoRes = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=id&format=json`
            )
            const geoData = await geoRes.json()
            const location = geoData?.results?.[0]
            if (!location) return reply(`❌ Kota/Wilayah *${city}* tidak ditemukan. Coba nama yang lebih spesifik.`)

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
                `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
                `&timezone=auto&forecast_days=3`
            )
            const wData = await weatherRes.json()
            const forecasts = Array.isArray(wData) ? wData : [wData]
            const mainForecast = forecasts[0]
            const c = mainForecast.current

            // WMO Weather Code → deskripsi + emoji
            const weatherDesc = (code) => {
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

            const windDir = (deg) => {
                const dirs = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL']
                return dirs[Math.round(deg / 45) % 8]
            }

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
                text += `📅 *Prakiraan 3 Hari:*\n`
            }

            const days = ['Hari ini', 'Besok', 'Lusa']
            for (let i = 0; i < 3; i++) {
                const [de, dd] = weatherDesc(mainForecast.daily.weather_code[i])
                text += `${de} *${days[i]}:* ${mainForecast.daily.temperature_2m_min[i]}°–${mainForecast.daily.temperature_2m_max[i]}°C, ${dd}`
                if (mainForecast.daily.precipitation_sum[i] > 0) text += `, hujan ${mainForecast.daily.precipitation_sum[i]}mm`
                text += '\n'
            }

            await reply(text.trim())
            await react('✅')
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal ambil data cuaca: ${err.message}`)
        }
    }
}