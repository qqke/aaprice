import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { validGtin } from './import-new-products.mjs'

const out = 'artifacts/products-round11-2026-10-29'
const origins = { bourbon: 'https://www.bourbon.co.jp', sakura: 'https://www.sakurasyokuhin.jp' }
const categories = ['okashi', 'syokuhin', 'icedessert', 'health', 'gift']
const plain = s => s.replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const p = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n); return p <= 0x10ffff ? String.fromCodePoint(p) : '' }).replace(/&(amp|nbsp|quot|apos|lt|gt|times);/g, (_, n) => ({ amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', times: '×' })[n]).replace(/\s+/g, ' ').trim()
const urlKey = s => { const u = new URL(s); return u.origin + decodeURIComponent(u.pathname).replace(/\/$/, '').toLowerCase() }
const links = html => [...new Set([...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'))) ]
export function directoryLinks(html, source) {
  return links(html).filter(u => source === 'bourbon' ? /^\/product\/detail\/[^/?#]+\.html$/.test(u) : /^https:\/\/www\.sakurasyokuhin\.jp\/products\/[^/?#]+\/$/.test(u) && !u.endsWith('/feed/')).map(u => new URL(u, origins[source]).href)
}
export function parseProduct(html, sourceUrl, source) {
  const fail = reason => ({ sourceUrl, reason })
  if (!origins[source] || new URL(sourceUrl).origin !== origins[source]) return fail('Unapproved product origin')
  const binding = html.match(source === 'bourbon' ? /<meta property="og:url"[^>]*content="([^"]+)"/ : /<link rel="canonical" href="([^"]+)"/)?.[1]
  if (!binding || urlKey(binding) !== urlKey(sourceUrl)) return fail('Missing or mismatched main product URL')
  let name, barcode, pack, image
  if (source === 'bourbon') {
    const one = cls => [...html.matchAll(new RegExp(`<[^>]+class="${cls}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'g'))].map(m => plain(m[1]))
    const names = one('rt_cf_p_product_name'), jans = one('rt_cf_p_jan_code'), packs = one('rt_cf_p_internal_capacity')
    if (names.length !== 1 || jans.length !== 1 || packs.length !== 1) return fail('Missing or ambiguous main name/JAN/native pack')
    ;[name, barcode, pack] = [names[0], jans[0], packs[0]]
    const images = [...html.matchAll(/<img\b[^>]*class="rt_cf_p_main_img1"[^>]*>/g)]
    if (images.length !== 1) return fail('Missing or ambiguous main image')
    image = images[0][0].match(/src="([^"]+)"/)?.[1]
    if (plain(images[0][0].match(/alt="([^"]*)"/)?.[1] || '').replace(/\s/g, '') !== name.replace(/\s/g, '')) return fail('Main image title differs from product name')
  } else {
    const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].filter(m => /JANコード/.test(m[1]))
    if (tables.length !== 1) return fail('Missing or multiple Japanese JAN tables')
    const pairs = [...tables[0][1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => [plain(m[1]), plain(m[2])])
    const jans = pairs.filter(([k]) => k === 'JANコード'), packs = pairs.filter(([k]) => k === '規格（容量・重量）')
    if (jans.length !== 1 || packs.length !== 1) return fail('Missing or ambiguous explicit JAN/native pack')
    barcode = jans[0][1]; pack = packs[0][1]
    name = plain(html.match(/<p class="h4">([\s\S]*?)<\/p>/)?.[1] || '')
    const images = [...html.matchAll(/<img\b[^>]*alt="商品画像"[^>]*>/g)]
    if (images.length !== 1) return fail('Missing or ambiguous same-page product image')
    image = images[0][0].match(/src="([^"]+)"/)?.[1]
  }
  if (!name || !/\d/.test(pack) || !/(?:[gｇＧmMlLｍＭｌＬℓ]|枚|本|個|袋|粒|包|缶|食|箱)/.test(pack)) return fail('Missing explicit native product name/unit')
  if (!/^(?:\d{8}|\d{12,14})$/.test(barcode) || !validGtin(barcode)) return fail('Invalid explicit GTIN')
  if (!image) return fail('Missing same-page image URL')
  const imageUrl = new URL(image.replace(/&amp;/g, '&'), sourceUrl).href
  if (new URL(imageUrl).origin !== origins[source] || /\.pdf(?:$|\?)/i.test(imageUrl)) return fail('Non-image or external image origin')
  return { barcode, name, brand: '', pack, category: '食品', description: '', imageUrl, sourceUrl, catalogSource: source }
}
export function uniqueProducts(products) {
  const rows = new Map(), excluded = [], conflicts = new Set()
  for (const row of products) {
    const key = row.barcode.padStart(14, '0'), previous = rows.get(key)
    if (conflicts.has(key)) excluded.push({ ...row, reason: 'Conflicting JAN identity' })
    else if (previous && (previous.name !== row.name || previous.pack !== row.pack)) { conflicts.add(key); rows.delete(key); excluded.push({ ...previous, reason: 'Conflicting JAN identity' }, { ...row, reason: 'Conflicting JAN identity' }) }
    else rows.set(key, row)
  }
  return { rows: [...rows.values()], excluded }
}
export function knownBarcodes(snapshot) {
  if (!Array.isArray(snapshot.canonicalBarcodes) || snapshot.canonicalBarcodes.some(x => typeof x !== 'string' || !/^\d{14}$/.test(x))) throw Error('Invalid canonicalBarcodes snapshot')
  return new Set(snapshot.canonicalBarcodes)
}
export function cacheAction(cached, offline) {
  if ([403, 429].includes(cached.status)) throw Error(`Hard stop cached HTTP${cached.status}: ${cached.url}`)
  if (cached.error) { if (offline) throw Error(`Transport failure in offline cache: ${cached.url}: ${cached.error}`); return 'retry' }
  return 'use'
}
export function pageBody(response) {
  if (response.status !== 200 || !/html|text\/plain/.test(response.contentType || '')) throw Error(`Unusable page ${response.status || response.error}: ${response.url}`)
  return response.html
}
export function imageHeadReason(response) {
  if (response.status >= 500) throw Error(`Image HTTP${response.status}: ${response.url}`)
  return response.status === 200 && /^image\//.test(response.contentType || '') ? null : 'Main image HEAD not 200 image/*'
}
async function main() {
  await mkdir(`${out}/cache`, { recursive: true })
  const offline = process.argv.includes('--offline'), report = { generatedAt: new Date().toISOString(), complete: false, offline, scope: 'Only 14 official Sakura index links and 270 Bourbon five-consumer-category links; no business-use/history/external sites.', delayMsPerOrigin: 2500, requests: [], excluded: [], processed: 0, databaseAccess: false }
  const last = new Map()
  async function request(url, method = 'GET', robots = false) {
    const origin = new URL(url).origin
    if (!Object.values(origins).includes(origin)) throw Error('External request origin rejected')
    const file = `${out}/cache/${createHash('sha256').update(method + ' ' + url).digest('hex')}.json`
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'))
      if (cacheAction(cached, offline) === 'use') return cached
      await writeFile(file + '.failed-' + Date.now() + '.json', JSON.stringify(cached))
    }
    catch (e) { if (e.code !== 'ENOENT') throw e }
    if (offline) throw Error(`Missing offline cache: ${method} ${url}`)
    await new Promise(r => setTimeout(r, Math.max(0, 2500 - (Date.now() - (last.get(origin) || 0))))); last.set(origin, Date.now())
    let result
    try {
      const r = await fetch(url, { method, signal: AbortSignal.timeout(30000) })
      if (new URL(r.url).origin !== origin) throw Error('Redirect outside source origin')
      result = { url, method, finalURL: r.url, status: r.status, contentType: r.headers.get('content-type'), fetchedAt: new Date().toISOString(), html: method === 'GET' ? await r.text() : '' }
    } catch (error) { result = { url, method, error: error.message, fetchedAt: new Date().toISOString() } }
    await writeFile(file, JSON.stringify(result)); report.requests.push({ url, method, status: result.status, error: result.error })
    if ([403, 429].includes(result.status)) throw Error(`Hard stop HTTP${result.status}: ${url}`)
    if (result.error) throw Error(`Transport failure: ${method} ${url}: ${result.error}`)
    if (robots && result.status === 404) return { ...result, html: '' }
    return result
  }
  async function get(url, robots = false) {
    const r = await request(url, 'GET', robots)
    if (robots && r.status === 404) return ''
    return pageBody(r)
  }
  const parsed = []
  try {
    let snapshot
    const frozenPath = `${out}/known-barcodes-frozen.json`
    try { snapshot = JSON.parse(await readFile(frozenPath, 'utf8')) }
    catch (e) {
      if (e.code !== 'ENOENT') throw e
      try { snapshot = JSON.parse(await readFile('artifacts/products-round7-2026-10-28/known-barcodes.json', 'utf8')) }
      catch (e) { if (e.code === 'ENOENT') { report.knownSnapshotUnavailable = true; snapshot = { canonicalBarcodes: [], unavailable: true } } else throw e }
      knownBarcodes(snapshot)
      await writeFile(frozenPath, JSON.stringify(snapshot))
    }
    const known = knownBarcodes(snapshot)
    report.knownSnapshotUnavailable = snapshot.unavailable === true
    report.knownSnapshotSHA256 = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    const targets = []
    for (const source of ['sakura', 'bourbon']) {
      const robots = await get(origins[source] + '/robots.txt', true)
      if (/^Disallow:\s*\/\s*$/m.test(robots) || /Disallow:\s*\/(?:product|products|product_file|skrweb\/wp-content)/i.test(robots)) throw Error(`Product routes disallowed: ${source}`)
      if (source === 'sakura') targets.push(...directoryLinks(await get(origins.sakura + '/products/'), source).map(sourceUrl => ({ source, sourceUrl })))
      else for (const id of categories) {
        const html = await get(`${origins.bourbon}/product/category_l/${id}/`), urls = directoryLinks(html, source)
        if (Number(html.match(/rt_bn_product_list_total">(\d+)/)?.[1]) !== urls.length) throw Error(`Incomplete category listing ${id}`)
        targets.push(...urls.map(sourceUrl => ({ source, sourceUrl })))
      }
    }
    const uniqueTargets = [...new Map(targets.map(t => [urlKey(t.sourceUrl), t])).values()]
    report.directoryCounts = Object.fromEntries(['sakura', 'bourbon'].map(s => [s, uniqueTargets.filter(t => t.source === s).length]))
    if (report.directoryCounts.sakura !== 14 || report.directoryCounts.bourbon !== 270) throw Error('Approved finite directory scope changed; review required')
    await writeFile(`${out}/bourbon-sakura-directory.json`, JSON.stringify(uniqueTargets, null, 2))
    for (const { source, sourceUrl } of uniqueTargets) {
      let row = parseProduct(await get(sourceUrl), sourceUrl, source)
      if (!row.reason) {
        const head = await request(row.imageUrl, 'HEAD')
        const reason = imageHeadReason(head)
        if (reason) row = { ...row, reason, imageEvidence: head }
      }
      if (row.reason) report.excluded.push(row); else parsed.push(row)
      report.processed++; report.parsed = parsed.length
      if (report.processed % 10 === 0) { await writeFile(`${out}/bourbon-sakura-progress.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ processed: report.processed, total: uniqueTargets.length, parsed: parsed.length, excluded: report.excluded.length })) }
    }
    const unique = uniqueProducts(parsed); report.excluded.push(...unique.excluded)
    const candidates = unique.rows.filter(r => !known.has(r.barcode.padStart(14, '0')))
    report.known = unique.rows.length - candidates.length; report.candidates = candidates.length; report.finalDeduplicationRequired = true
    for (const source of ['sakura', 'bourbon']) await writeFile(`${out}/${source}.json`, JSON.stringify(candidates.filter(r => r.catalogSource === source), null, 2) + '\n')
    report.complete = true
  } catch (error) { report.error = error.message; process.exitCode = 1 }
  finally { await writeFile(`${out}/bourbon-sakura-report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ complete: report.complete, processed: report.processed, candidates: report.candidates, excluded: report.excluded.length, error: report.error })) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
