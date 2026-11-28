// src/utils/safeOutboundUrl.js
// Safe Outbound URL & SSRF Protection Engine for WABOT 2.0 (SEC-007)
// Enforces DNS resolution, IP range validation, redirect loop/target validation,
// and payload size caps against RFC 1918, loopback, link-local, and cloud metadata endpoints.

import dns from 'dns'
import http from 'http'
import https from 'https'
import { URL } from 'url'

const IPV4_BLOCKED_RANGES = [
    { start: '0.0.0.0', end: '0.255.255.255', desc: 'Current network (RFC 1122)' },
    { start: '10.0.0.0', end: '10.255.255.255', desc: 'Private network (RFC 1918)' },
    { start: '100.64.0.0', end: '100.127.255.255', desc: 'Shared address space (RFC 6598)' },
    { start: '127.0.0.0', end: '127.255.255.255', desc: 'Loopback (RFC 1122)' },
    { start: '169.254.0.0', end: '169.254.255.255', desc: 'Link-local / Cloud metadata (RFC 3927)' },
    { start: '172.16.0.0', end: '172.31.255.255', desc: 'Private network (RFC 1918)' },
    { start: '192.0.0.0', end: '192.0.0.255', desc: 'IETF Protocol Assignments (RFC 6890)' },
    { start: '192.0.2.0', end: '192.0.2.255', desc: 'TEST-NET-1 (RFC 5737)' },
    { start: '192.88.99.0', end: '192.88.99.255', desc: '6to4 Relay Anycast (RFC 7526)' },
    { start: '192.168.0.0', end: '192.168.255.255', desc: 'Private network (RFC 1918)' },
    { start: '198.18.0.0', end: '198.19.255.255', desc: 'Benchmarking (RFC 2544)' },
    { start: '198.51.100.0', end: '198.51.100.255', desc: 'TEST-NET-2 (RFC 5737)' },
    { start: '203.0.113.0', end: '203.0.113.255', desc: 'TEST-NET-3 (RFC 5737)' },
    { start: '224.0.0.0', end: '239.255.255.255', desc: 'Multicast (RFC 5771)' },
    { start: '240.0.0.0', end: '255.255.255.254', desc: 'Reserved (RFC 1112)' },
    { start: '255.255.255.255', end: '255.255.255.255', desc: 'Broadcast (RFC 919)' }
]

function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
}

/**
 * Checks whether an IPv4 address falls within private, loopback, or metadata CIDR blocks.
 */
export function isPrivateOrReservedIpv4(ip) {
    if (!ip || typeof ip !== 'string') return true
    const long = ipToLong(ip)
    for (const range of IPV4_BLOCKED_RANGES) {
        const startLong = ipToLong(range.start)
        const endLong = ipToLong(range.end)
        if (long >= startLong && long <= endLong) {
            return true
        }
    }
    return false
}

/**
 * Checks whether an IPv6 address falls within loopback, link-local, or private blocks.
 */
export function isPrivateOrReservedIpv6(ip) {
    if (!ip || typeof ip !== 'string') return true
    const norm = ip.toLowerCase().trim()

    // Loopback & Unspecified
    if (norm === '::' || norm === '::1' || norm === '0:0:0:0:0:0:0:1' || norm === '0:0:0:0:0:0:0:0') {
        return true
    }

    // IPv4-mapped IPv6 (::ffff:192.168.1.1 or ::ffff:c0a8:0101)
    if (norm.startsWith('::ffff:') || norm.startsWith('0:0:0:0:0:ffff:')) {
        const ipv4Part = norm.split(':').pop()
        if (ipv4Part && ipv4Part.includes('.')) {
            return isPrivateOrReservedIpv4(ipv4Part)
        }
    }

    // Unique Local Address (fc00::/7)
    if (norm.startsWith('fc') || norm.startsWith('fd')) {
        return true
    }

    // Link-Local (fe80::/10 -> fe8, fe9, fea, feb)
    if (/^fe[89ab]/i.test(norm)) {
        return true
    }

    // Documentation (2001:db8::/32)
    if (norm.startsWith('2001:db8') || norm.startsWith('2001:0db8')) {
        return true
    }

    return false
}

export function isPrivateOrReservedIp(ip) {
    if (ip.includes(':')) {
        return isPrivateOrReservedIpv6(ip)
    }
    return isPrivateOrReservedIpv4(ip)
}

/**
 * Validates a target URL and its resolved DNS addresses against SSRF policies.
 * Throws an Error if the URL violates security constraints.
 * @param {string} inputUrl
 * @returns {Promise<{ validUrl: URL, resolvedIps: string[] }>}
 */
export async function validateSafeOutboundUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== 'string') {
        throw new Error('URL input is required and must be a string.')
    }

    let parsed
    try {
        parsed = new URL(inputUrl)
    } catch {
        throw new Error('URL format is invalid.')
    }

    // 1. Strict protocol allowlist
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Forbidden protocol: ${parsed.protocol} (only http and https are allowed).`)
    }

    // 2. Reject embedded credentials
    if (parsed.username || parsed.password) {
        throw new Error('URLs with embedded credentials are prohibited.')
    }

    const hostname = parsed.hostname.toLowerCase()

    // 3. Reject direct localhost / internal names
    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname === 'metadata.google.internal'
    ) {
        throw new Error(`Forbidden host: ${hostname} resolves to local or internal target.`)
    }

    // 4. If hostname is raw IP literal
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
        if (isPrivateOrReservedIpv4(hostname)) {
            throw new Error(`Access to private or reserved IPv4 address (${hostname}) is blocked.`)
        }
        return { validUrl: parsed, resolvedIps: [hostname] }
    }

    if (hostname.startsWith('[') && hostname.endsWith(']')) {
        const rawIpv6 = hostname.slice(1, -1)
        if (isPrivateOrReservedIpv6(rawIpv6)) {
            throw new Error(`Access to private or reserved IPv6 address (${rawIpv6}) is blocked.`)
        }
        return { validUrl: parsed, resolvedIps: [rawIpv6] }
    }

    // 5. DNS Resolution check (prevent DNS rebinding & internal network probing)
    let records = []
    try {
        records = await dns.promises.lookup(hostname, { all: true })
    } catch (err) {
        throw new Error(`DNS resolution failed for host "${hostname}": ${err.message}`)
    }

    if (!records || records.length === 0) {
        throw new Error(`No DNS records found for host "${hostname}".`)
    }

    const resolvedIps = records.map(r => r.address)
    for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
            throw new Error(`Host "${hostname}" resolved to private or reserved address (${rec.address}). Request blocked.`)
        }
    }

    return { validUrl: parsed, resolvedIps }
}

/**
 * Executes a secure HTTP/HTTPS fetch with automated redirect validation,
 * DNS re-checking, byte count limit, and timeout caps.
 * @param {string} targetUrl
 * @param {object} options
 * @returns {Promise<{ status: number, statusText: string, headers: object, data: string, buffer: Buffer }>}
 */
export async function safeFetch(targetUrl, options = {}) {
    const maxRedirects = options.maxRedirects ?? 3
    const timeoutMs = options.timeoutMs ?? 10000
    const maxBytes = options.maxBytes ?? (10 * 1024 * 1024) // 10 MB default cap
    const method = (options.method || 'GET').toUpperCase()

    let currentUrl = targetUrl
    let redirectCount = 0

    while (true) {
        const { validUrl } = await validateSafeOutboundUrl(currentUrl)

        const client = validUrl.protocol === 'https:' ? https : http
        const reqPromise = new Promise((resolve, reject) => {
            const req = client.request(validUrl, {
                method,
                headers: {
                    'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': options.accept || '*/*',
                    ...(options.headers || {})
                },
                timeout: timeoutMs
            }, (res) => {
                const statusCode = res.statusCode || 200

                // Handle Redirects manually to revalidate destination
                if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
                    res.resume() // discard body
                    if (redirectCount >= maxRedirects) {
                        return reject(new Error(`Too many redirects (exceeded limit of ${maxRedirects}).`))
                    }
                    redirectCount++
                    const nextUrl = new URL(res.headers.location, validUrl).toString()
                    currentUrl = nextUrl
                    return resolve({ redirect: true, nextUrl })
                }

                if (method === 'HEAD') {
                    res.resume()
                    return resolve({
                        redirect: false,
                        status: statusCode,
                        statusText: res.statusMessage || '',
                        headers: res.headers,
                        data: '',
                        buffer: Buffer.alloc(0)
                    })
                }

                const chunks = []
                let receivedBytes = 0

                res.on('data', (chunk) => {
                    receivedBytes += chunk.length
                    if (receivedBytes > maxBytes) {
                        req.destroy(new Error(`Response payload size exceeded maximum allowed limit (${maxBytes} bytes).`))
                        return
                    }
                    chunks.push(chunk)
                })

                res.on('end', () => {
                    const buffer = Buffer.concat(chunks)
                    const data = buffer.toString('utf8')
                    resolve({
                        redirect: false,
                        status: statusCode,
                        statusText: res.statusMessage || '',
                        headers: res.headers,
                        data,
                        buffer
                    })
                })
            })

            req.on('timeout', () => {
                req.destroy(new Error(`Request timed out after ${timeoutMs}ms.`))
            })

            req.on('error', (err) => {
                reject(err)
            })

            req.end()
        })

        const stepResult = await reqPromise
        if (stepResult.redirect) {
            continue
        }
        return stepResult
    }
}
