// src/core/loader.js
import { readdirSync, statSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { logger } from '../utils/logger.js'

export const commands = new Map()

let loadedCount = 0

export async function loadCommands(dir = './src/commands') {
    if (dir === './src/commands') {
        commands.clear() // Bersihkan map sebelum load ulang saat reconnect
        loadedCount = 0
    }
    
    let entries = []
    try {
        entries = readdirSync(dir)
    } catch (err) {
        process.stdout.write(`\n❌ [Loader Error] Gagal membaca folder ${dir}: ${err.message}\n`)
        return
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry)
        const isDir = statSync(fullPath).isDirectory()

        if (isDir) {
            await loadCommands(fullPath)
            continue
        }

        if (!entry.endsWith('.js')) continue

        try {
            const absolutePath = path.resolve(fullPath)
            const fileURL = pathToFileURL(absolutePath).href

            const mod = await import(fileURL)
            const cmd = mod.default

            if (!cmd) {
                process.stdout.write(`\n⚠️  [Loader Warning] Berkas ${entry} tidak memiliki 'export default'!\n`)
                continue
            }
            if (!cmd.name) {
                process.stdout.write(`\n⚠️  [Loader Warning] Berkas ${entry} kehilangan properti 'name'!\n`)
                continue
            }

            if (commands.has(cmd.name)) {
                const existing = commands.get(cmd.name)
                process.stdout.write(`\n⚠️  [Loader Conflict] Nama command '${cmd.name}' di ${entry} menimpa command/alias yang sudah terdaftar (${existing.name} [kategori: ${existing.category}])!\n`)
            }
            commands.set(cmd.name, cmd)
            loadedCount++

            if (cmd.aliases) {
                for (const alias of cmd.aliases) {
                    if (commands.has(alias)) {
                        const existing = commands.get(alias)
                        process.stdout.write(`\n⚠️  [Loader Conflict] Alias '${alias}' di ${entry} menimpa command/alias yang sudah terdaftar (${existing.name} [kategori: ${existing.category}])!\n`)
                    }
                    commands.set(alias, cmd)
                    loadedCount++
                }
            }

            process.stdout.write(`\r\x1b[K🔍 [Loader] Memuat command: ${cmd.name}...`)
            logger.info(`Loaded command: ${cmd.name} [${cmd.category}]`)

        } catch (importErr) {
            process.stdout.write(`\n❌ [Loader Error] Gagal import ${fullPath}: ${importErr.message}\n`)
        }
    }

    if (dir === './src/commands') {
        process.stdout.write(`\r\x1b[K✅ [Loader] Berhasil memuat ${loadedCount} command & alias ke dalam registry!\n`)
    }
}