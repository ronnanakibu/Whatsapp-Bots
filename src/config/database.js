// src/config/database.js
import { PrismaClient } from '@prisma/client'
import { dbConfig } from './index.js'
import { logger } from '../utils/logger.js'

let prismaInstance = null

function getPrismaClient() {
    if (!prismaInstance) {
        try {
            prismaInstance = new PrismaClient({
                datasources: {
                    db: {
                        url: dbConfig.url,
                    },
                },
                log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
            })
        } catch (e) {
            logger.warn(`[Prisma] Shared library loading skipped: ${e.message}`)
            prismaInstance = new Proxy({}, {
                get() {
                    return () => Promise.resolve(null)
                }
            })
        }
    }
    return prismaInstance
}

export const prisma = new Proxy({}, {
    get(target, prop) {
        try {
            const client = getPrismaClient()
            const value = client[prop]
            if (typeof value === 'function') {
                return value.bind(client)
            }
            return value
        } catch (e) {
            logger.warn(`[Prisma] Action ignored due to engine mismatch: ${e.message}`)
            return () => Promise.resolve(null)
        }
    }
})

export default prisma
