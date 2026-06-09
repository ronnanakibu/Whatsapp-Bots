// src/services/alarm.js
// Alarm service untuk reminder
// "Call" diganti react spam — HP bunyi 4x dalam 30 detik

export async function triggerAlarm(sock, chatId, message, _useCall = false, quotedMsgStr = null) {
    const TZ = process.env.BOT_TIMEZONE ?? 'Asia/Jakarta'
    const timeStr = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: TZ
    })

    // Kirim pesan reminder
    let sentMsg = null
    try {
        sentMsg = await sock.sendMessage(chatId, {
            text:
                `⏰ *REMINDER!*\n\n` +
                `📌 *${message}*\n\n` +
                `🕐 ${timeStr}\n` +
                `_Set reminder baru: !remindme [waktu] [pesan]_`
        })

        // Forward pesan jika ada quoted_msg
        if (quotedMsgStr) {
            try {
                const quotedMsg = JSON.parse(quotedMsgStr)
                await sock.sendMessage(chatId, { forward: { key: { remoteJid: chatId, fromMe: false, id: "fake" }, message: quotedMsg } })
            } catch (e) {
                console.error('[Alarm] Gagal forward quoted msg:', e)
            }
        }
    } catch (err) {
        console.error('[Alarm] Gagal kirim pesan:', err.message)
        return
    }

    // React spam background — tidak blocking
    // HP bunyi setiap react (total 4x: pesan + 3 react)
    if (sentMsg?.key) {
        const reacts = ['⏰', '🔔', '‼️']
            ; (async () => {
                for (const emoji of reacts) {
                    await new Promise(r => setTimeout(r, 10_000))
                    try {
                        await sock.sendMessage(chatId, {
                            react: { text: emoji, key: sentMsg.key }
                        })
                    } catch (_) { }
                }
            })()
    }
}

// ... kode triggerAlarm lu yang lama tetap di atas ...

/**
 * Fungsi untuk menghapus/reset reminder milik user tertentu
 * @param {string} chatId - ID Group atau ID Chat JID
 * @param {string} userId - ID Pengirim (sender JID)
 */
export async function clearUserReminders(chatId, userId) {
    try {

        console.log(`[Alarm] Memproses reset reminder untuk ${userId} di chat ${chatId}`)

        // Sementara kita return true sebagai tanda fungsi berhasil dipanggil
        return true
    } catch (err) {
        console.error('[Alarm] Gagal melakukan reset reminder:', err.message)
        return false
    }
}