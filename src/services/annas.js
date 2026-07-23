import axios from 'axios'
import * as cheerio from 'cheerio'
import https from 'https'

const ANNAS_DOMAINS = [
    'https://annas-archive.gl',
    'https://annas-archive.li',
    'https://annas-archive.gs',
    'https://annas-archive.org',
    'https://annas-archive.se',
    'https://annas-archive.pm'
]

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
})

export function extractMd5(input) {
    if (!input) return null
    const md5Match = input.match(/[a-fA-F0-9]{32}/)
    return md5Match ? md5Match[0].toLowerCase() : null
}

export function parseMetaInformation(metaText) {
    if (!metaText) return { language: '', format: '', size: '' }
    const parts = metaText.split('·').map(p => p.trim())
    if (parts.length < 3) {
        return {
            language: parts[0] || '',
            format: parts[1] || '',
            size: parts[2] || ''
        }
    }
    return {
        language: parts[0],
        format: parts[1],
        size: parts[2]
    }
}

export class AnnasService {
    constructor() {
        this.baseUrl = ANNAS_DOMAINS[0]
    }

    async getAxiosInstance() {
        return axios.create({
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            },
            httpsAgent,
            timeout: 8000
        })
    }

    async resolveDirectDownloadUrl(md5, ipfsCids = []) {
        const client = await this.getAxiosInstance()
        const md5Upper = md5.toUpperCase()
        const md5Lower = md5.toLowerCase()

        // 1. Try IPFS Gateways FIRST if CIDs exist
        if (ipfsCids && ipfsCids.length > 0) {
            const ipfsGateways = [
                'https://dweb.link/ipfs/',
                'https://ipfs.filebase.io/ipfs/',
                'https://w3s.link/ipfs/',
                'https://nftstorage.link/ipfs/',
                'https://ipfs.io/ipfs/'
            ]
            for (const cid of ipfsCids) {
                for (const gw of ipfsGateways) {
                    const gwUrl = `${gw}${cid}`
                    try {
                        const res = await client.get(gwUrl, { timeout: 3500, responseType: 'stream' })
                        if (res.status === 200) {
                            if (res.data && res.data.destroy) res.data.destroy()
                            return gwUrl
                        }
                    } catch (e) {
                        console.warn(`[AnnasService] IPFS resolver ${gwUrl} failed: ${e.message}`)
                    }
                }
            }
        }

        // 2. Try Libgen Ads-based mirrors (.li, .rocks, .st, .gs, .lc)
        const adsDomains = [
            'https://libgen.li',
            'https://libgen.rocks',
            'https://libgen.st',
            'https://libgen.gs',
            'https://libgen.lc'
        ]

        for (const domain of adsDomains) {
            try {
                const adsUrl = `${domain}/ads.php?md5=${md5Lower}`
                const res = await client.get(adsUrl, { timeout: 3500 })
                const $ = cheerio.load(res.data)
                const getHref = $('a[href*="get.php"]').attr('href')
                if (getHref) {
                    const fullUrl = getHref.startsWith('http') ? getHref : `${domain}/${getHref}`
                    return fullUrl
                }
            } catch (err) {
                console.warn(`[AnnasService] Resolver ${domain} failed: ${err.message}`)
            }
        }

        // 3. Try Libgen Index-based mirrors (.is, .rs) -> Library.lol
        const indexDomains = [
            'https://libgen.is',
            'https://libgen.rs'
        ]

        for (const domain of indexDomains) {
            try {
                const indexUrl = `${domain}/book/index.php?md5=${md5Upper}`
                const res = await client.get(indexUrl, { timeout: 3500 })
                const $ = cheerio.load(res.data)
                let lolLink = ''
                $('a[href]').each((_, el) => {
                    const href = $(el).attr('href') || ''
                    if (href.includes('library.lol') || href.includes('libgen.rocks')) {
                        lolLink = href
                    }
                })
                if (lolLink) {
                    const lolRes = await client.get(lolLink, { timeout: 3500 })
                    const $lol = cheerio.load(lolRes.data)
                    const directUrl = $lol('h1 a[href]').first().attr('href') || $lol('a[href*="get.php"]').first().attr('href') || $lol('a[href*="download"]').first().attr('href')
                    if (directUrl) return directUrl
                }
            } catch (err) {
                console.warn(`[AnnasService] Resolver ${domain} failed: ${err.message}`)
            }
        }

        // 4. Try direct Library.lol mirrors
        const lolDirectUrls = [
            `https://library.lol/main/${md5Upper}`,
            `https://library.lol/fiction/${md5Upper}`
        ]

        for (const lolUrl of lolDirectUrls) {
            try {
                const res = await client.get(lolUrl, { timeout: 3500 })
                const $ = cheerio.load(res.data)
                const directUrl = $('h1 a[href]').first().attr('href') || $('a[href*="get.php"]').first().attr('href')
                if (directUrl) return directUrl
            } catch (err) {
                console.warn(`[AnnasService] Resolver ${lolUrl} failed: ${err.message}`)
            }
        }

        return null
    }

    async searchBooks(query, limit = 5) {
        const client = await this.getAxiosInstance()
        let lastError = null

        for (const domain of ANNAS_DOMAINS) {
            try {
                const searchUrl = `${domain}/search?q=${encodeURIComponent(query)}&content=book_any`
                const response = await client.get(searchUrl)
                const $ = cheerio.load(response.data)
                const bookList = []

                $('a[href*="/md5/"]').each((_, element) => {
                    const $el = $(element)
                    const href = $el.attr('href') || ''
                    const md5 = extractMd5(href)
                    if (!md5) return

                    // Filter cover image container links
                    if ($el.find('img').length > 0 && !$el.text().trim()) return

                    const container = $el.closest('div.flex') || $el.parent()
                    const title = $el.text().trim() || container.find('h3').text().trim() || 'Untitled Book'

                    // Meta info (Language · Format · Size)
                    const metaDiv = container.find('div.text-gray-800, div.text-gray-500, div.text-xs').first()
                    const metaText = metaDiv.text().trim()
                    const meta = parseMetaInformation(metaText)

                    // Author
                    const authorEl = container.find('a[href*="/search?q="]').first()
                    const author = authorEl.text().trim() || 'Unknown Author'

                    // Avoid duplicate MD5 in list
                    if (!bookList.some(b => b.md5 === md5) && title) {
                        bookList.push({
                            title,
                            author,
                            language: meta.language,
                            format: meta.format.replace(/[\[\]]/g, ''),
                            size: meta.size,
                            md5,
                            url: `${domain}/md5/${md5}`
                        })
                    }
                })

                if (bookList.length > 0) {
                    this.baseUrl = domain
                    return bookList.slice(0, limit)
                }
            } catch (err) {
                lastError = err
                continue
            }
        }

        throw new Error(lastError ? `Gagal mencari di Anna's Archive: ${lastError.message}` : 'Buku tidak ditemukan di Anna\'s Archive.')
    }

    async getBookDetails(md5OrUrl) {
        const md5 = extractMd5(md5OrUrl)
        if (!md5) throw new Error('MD5 hash atau URL Anna\'s Archive tidak valid.')

        const client = await this.getAxiosInstance()
        const secretKey = process.env.ANNAS_SECRET_KEY

        // Check Fast Download API if Secret Key is provided
        if (secretKey) {
            try {
                const apiRes = await client.get(`https://annas-archive.gl/dyn/api/fast_download.json`, {
                    params: { key: secretKey, md5 }
                })
                if (apiRes.data && apiRes.data.download_url) {
                    return {
                        md5,
                        directUrl: apiRes.data.download_url,
                        isFast: true
                    }
                }
            } catch (err) {
                console.warn(`[AnnasService] Fast Download API key error: ${err.message}`)
            }
        }

        // Fetch detail page from Anna's Archive
        let htmlData = null
        let resolvedDomain = this.baseUrl

        for (const domain of ANNAS_DOMAINS) {
            try {
                const detailUrl = `${domain}/md5/${md5}`
                const res = await client.get(detailUrl)
                if (res.data && res.data.includes('html')) {
                    htmlData = res.data
                    resolvedDomain = domain
                    break
                }
            } catch (err) {
                continue
            }
        }

        if (!htmlData) throw new Error('Gagal mengambil halaman detail buku dari Anna\'s Archive.')

        const $ = cheerio.load(htmlData)

        // Title extraction
        let title = ''
        $('div.text-3xl, div.text-2xl, div.font-bold.text-xl').each((_, el) => {
            const text = $(el).text().trim().replace(/\s+/g, ' ')
            if (
                !title && text &&
                !text.includes('Recent downloads') &&
                !text.includes('Anna’s Archive') &&
                !text.includes("Anna's Archive") &&
                !text.includes('Search') &&
                !text.includes('Donate') &&
                !text.includes('Downloaded files') &&
                text.length > 2
            ) {
                title = text
            }
        })
        if (!title) title = 'Book Detail'

        // Authors extraction
        let authors = []
        $('a[href*="/search?q="]').each((_, el) => {
            const text = $(el).text().trim()
            if (text && !text.includes('Search') && !text.includes('Anna') && !text.includes('🔍') && !text.includes('🔑') && !authors.includes(text)) {
                authors.push(text)
            }
        })
        const authorStr = authors.length > 0 ? authors.join(', ') : 'Unknown'

        // Meta info (Language, Format, Size)
        let metaText = ''
        $('div.text-md, div.text-sm, div.text-gray-800, div.text-gray-500').each((_, el) => {
            const text = $(el).text().trim().replace(/\s+/g, ' ')
            if (!metaText && text.includes('·') && (text.includes('MB') || text.includes('KB') || text.includes('GB') || text.includes('EPUB') || text.includes('PDF'))) {
                metaText = text
            }
        })
        const meta = parseMetaInformation(metaText)

        // Find IPFS CIDs & download mirrors on detail page
        const ipfsCids = []
        const mirrors = []
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || ''
            const text = $(el).text().trim().replace(/\s+/g, ' ')

            if (href.includes('ipfs') || text.includes('ipfs_cid:')) {
                const cidMatch = href.match(/(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]{55,65})/) || text.match(/(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]{55,65})/)
                if (cidMatch && !ipfsCids.includes(cidMatch[1])) {
                    ipfsCids.push(cidMatch[1])
                }
            }

            if (
                href.includes('/slow_download/') ||
                href.includes('/fast_download/') ||
                href.includes('libgen.is') ||
                href.includes('libgen.li') ||
                href.includes('libgen.rs') ||
                (href.includes('/ipfs/') && !href.startsWith('ipfs://'))
            ) {
                let fullUrl = href
                if (href.startsWith('/')) {
                    fullUrl = `${resolvedDomain}${href}`
                }

                const isUsefulLabel = text && 
                    !text.includes('open in viewer') && 
                    !text.includes('no redirect') && 
                    !text.includes('short filename') &&
                    !text.includes('ipfs://')

                if (isUsefulLabel && !mirrors.some(m => m.url === fullUrl)) {
                    mirrors.push({
                        label: text,
                        url: fullUrl
                    })
                }
            }
        })

        // Try resolving direct download URL with IPFS CIDs support
        let resolvedDirectUrl = await this.resolveDirectDownloadUrl(md5, ipfsCids)

        return {
            title,
            author: authorStr,
            language: meta.language,
            format: meta.format,
            size: meta.size,
            md5,
            detailUrl: `${resolvedDomain}/md5/${md5}`,
            directUrl: resolvedDirectUrl,
            mirrors
        }
    }

    async downloadFileBuffer(downloadUrl) {
        const client = await this.getAxiosInstance()
        const response = await client.get(downloadUrl, {
            responseType: 'arraybuffer',
            maxRedirects: 10,
            headers: {
                'Referer': new URL(downloadUrl).origin,
                'User-Agent': DEFAULT_USER_AGENT
            }
        })

        const contentType = response.headers['content-type'] || 'application/octet-stream'
        const contentDisposition = response.headers['content-disposition'] || ''
        
        let fileName = 'book.pdf'
        const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
        if (fileNameMatch && fileNameMatch[1]) {
            fileName = fileNameMatch[1]
        }

        return {
            buffer: Buffer.from(response.data),
            contentType,
            fileName,
            size: response.data.byteLength
        }
    }
}

export const annasService = new AnnasService()
