import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { validGtin } from './import-new-products.mjs'
import { databaseProcess } from './sync-sundrug.mjs'

const origin = 'https://www.soft99.co.jp', out = 'artifacts/products-round7-2026-10-28'
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&(amp|nbsp|quot|apos|lt|gt|times);/g, (_, n) => ({ amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', times: '×' })[n]).replace(/\s+/g, ' ').trim()
export function parseProduct(html, sourceUrl) {
  const tables = [...html.matchAll(/<table class="productTable">([\s\S]*?)<\/table>/g)]
  if (tables.length !== 1) return { reason: 'Missing or multiple main product tables', sourceUrl }
  const pairs = [...tables[0][1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => [plain(m[1]), plain(m[2])])
  if (['商品名', 'JANコード', '内容'].some(k => pairs.filter(([key]) => key === k).length !== 1)) return { reason: 'Missing or duplicate identity fields', sourceUrl }
  const fields = Object.fromEntries(pairs)
  const barcode = fields['JANコード'], name = fields['商品名'], pack = fields['内容']
  if (!barcode || !/^\d{13}$/.test(barcode) || !validGtin(barcode)) return { reason: 'Missing, ambiguous or invalid explicit JAN', sourceUrl }
  const imageUrl = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1]
  const code = new URL(sourceUrl).pathname.match(/^\/products\/detail\/(\d+)\/$/)?.[1]
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
  if (!code || canonical !== sourceUrl || !new URL(imageUrl || origin).pathname.startsWith(`/uploadimg/${code}_`)) return { reason: 'Canonical or main image product identity mismatch', sourceUrl, barcode }
  if (!name || !pack || !imageUrl?.startsWith(origin + '/uploadimg/')) return { reason: 'Missing name, pack or official main image', sourceUrl, barcode }
  if (!html.includes(`src="${new URL(imageUrl).pathname}" alt="メイン写真"`)) return { reason: 'Main image not corroborated on product page', sourceUrl, barcode }
  return { barcode, name, pack, brand: '株式会社ソフト９９コーポレーション', category: '', description: '', imageUrl, sourceUrl, catalogSource: 'soft99' }
}
async function main() {
  await mkdir(out, { recursive: true })
  let last = 0
  const requests = []
  async function get(url) {
    if (new URL(url).origin !== origin) throw Error('External URL rejected')
    const file = `${out}/soft99-cache-${Buffer.from(url).toString('base64url')}.html`
    try { return await readFile(file, 'utf8') } catch {}
    if (process.argv.includes('--offline')) throw Error(`Missing offline cache: ${url}`)
    await new Promise(r => setTimeout(r, Math.max(0, 2500 - (Date.now() - last))))
    last = Date.now()
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    requests.push({ url, status: response.status })
    if (!response.ok) throw Error(`HTTP ${response.status}: ${url}; stopped without retry`)
    const html = await response.text()
    await writeFile(file, html)
    return html
  }
  const report = { requests, databaseWrites: false, delayMs: 2500, complete: false }
  try {
    const robots = await get(origin + '/robots.txt')
    if (robots.split(/\r?\n/).some(line => /^Disallow:\s*\/products/i.test(line) || /^Disallow:\s*\/$/.test(line))) throw Error('Products disallowed by robots')
    const roots = ['car_wash','repair','car_maintenance','home_care','glasses_care','sports_care']
    const queue = ['/products/', ...roots.map(r => `/products/${r}/`), '/products/new_release/'], visited = new Set(), products = new Set()
    while (queue.length) {
      const path = queue.shift()
      if (visited.has(path)) continue
      const html = await get(origin + path)
      visited.add(path)
      for (const m of html.matchAll(/href="([^"]+)"/g)) {
        const u = new URL(m[1].replace(/&amp;/g, '&'), origin)
        if (u.origin !== origin) continue
        if (/^\/products\/detail\/\d+\/$/.test(u.pathname)) products.add(u.href)
        else if ((roots.some(r => u.pathname.startsWith(`/products/${r}/`) || u.pathname.startsWith(`/products/category/${r}-`))) && !visited.has(u.pathname)) queue.push(u.pathname)
      }
    }
    report.directoryPages = [...visited]; report.discoveredProducts = products.size; report.productUrls = [...products]
    await writeFile(`${out}/soft99-directory.json`, JSON.stringify(report, null, 2))
    if (process.argv.includes('--directory-only')) return
    const existing = process.argv.includes('--offline')
      ? new Set(JSON.parse(await readFile(`${out}/known-barcodes.json`, 'utf8')).canonicalBarcodes)
      : new Set(databaseProcess(process.env.AAPRICE_DB_URL, "begin read only; select lpad(barcode,14,'0') from public.products where barcode ~ '^([0-9]{8}|[0-9]{12,14})$'; commit;").split(/\s+/))
    if (process.argv.includes('--offline')) report.knownBarcodeLimitation = 'Uses known-barcodes.json baseline plus successful receipts snapshot; external changes may be missing. Final importer must recheck existing barcodes.'
    const rows = new Map(), excluded = [], conflicts = new Set()
    for (const url of products) {
      const row = parseProduct(await get(url), url)
      if (row.reason) excluded.push(row)
      else if (!existing.has(row.barcode.padStart(14, '0'))) {
        const previous = rows.get(row.barcode)
        if (conflicts.has(row.barcode)) excluded.push({ ...row, reason: 'Conflicting JAN identity' })
        else if (previous && (previous.name !== row.name || previous.pack !== row.pack)) {
          conflicts.add(row.barcode); rows.delete(row.barcode)
          excluded.push({ ...previous, reason: 'Conflicting JAN identity' }, { ...row, reason: 'Conflicting JAN identity' })
        } else rows.set(row.barcode, row)
      }
      if ((rows.size + excluded.length) % 25 === 0) console.log(JSON.stringify({ processedCandidates: rows.size, excluded: excluded.length, url }))
    }
    report.candidates = rows.size; report.excluded = excluded; report.complete = true
    report.coverageLimit = 'Six public consumer categories and new releases; discontinued, professional-only and brand-only routes not audited.'
    await writeFile(`${out}/soft99.json`, JSON.stringify([...rows.values()], null, 2))
  } catch (error) { report.error = error.message; process.exitCode = 1 }
  finally { await writeFile(`${out}/soft99-report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
