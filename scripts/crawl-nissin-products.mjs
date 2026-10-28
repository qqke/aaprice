import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { validGtin } from './import-new-products.mjs'

const out = 'artifacts/products-round9-2026-10-28'
const origins = { nissin: 'https://www.nissin.com', myojo: 'https://www.myojofoods.co.jp' }
const plain = s => s.replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const p = /^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n); return p <= 0x10ffff ? String.fromCodePoint(p) : '' }).replace(/&(amp|nbsp|quot|apos|lt|gt|times);/g, (_, n) => ({ amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', times: '×' })[n]).replace(/\s+/g, ' ').trim()
const normalizedUrl = u => { const x = new URL(u); x.hash = ''; x.pathname = x.pathname.replace(/\/$/, ''); return x.href }
export function directoryLinks(html) {
  return [...new Set([...html.matchAll(/href="(\/jp\/product\/items\/\d+\/)"/g)].map(m => origins.nissin + m[1]))]
}
export function parseProduct(html, api, sourceUrl, source) {
  const fail = reason => ({ sourceUrl, reason })
  const id = new URL(sourceUrl).pathname.match(/\/items\/(\d+)\/?$/)?.[1]
  if (!id || String(api.id) !== id || api.is_official !== true) return fail('Official API product identity mismatch')
  const binding = source === 'myojo' ? html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] : html.match(/<meta property="og:url" content="([^"]+)"/)?.[1]
  if (!binding || normalizedUrl(binding) !== normalizedUrl(sourceUrl)) return fail('Product page URL identity mismatch')
  const name = plain(html.match(source === 'myojo' ? /<h1 class="ns-headline_01">([\s\S]*?)<\/h1>/ : /<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '')
  let pairs
  if (source === 'myojo') {
    const spec = [...html.matchAll(/<div class="ns-p-item__main__item-spec">([\s\S]*?)<\/div>/g)]
    if (spec.length !== 1) return fail('Missing or multiple main specification sections')
    pairs = [...spec[0][1].matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].map(m => [plain(m[1]), plain(m[2])])
  } else {
    const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].filter(m => /JANコード/.test(m[1]))
    if (tables.length !== 1) return fail('Missing or multiple main JAN tables')
    pairs = [...tables[0][1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => [plain(m[1]), plain(m[2])])
  }
  const jan = pairs.filter(([k]) => k === 'JANコード'), packs = pairs.filter(([k]) => k.startsWith('内容量'))
  if (jan.length !== 1 || packs.length !== 1) return fail('Missing or ambiguous explicit JAN/native contents')
  const barcode = jan[0][1], pack = packs[0][1]
  if (!/^(?:\d{8}|\d{12,14})$/.test(barcode) || !validGtin(barcode) || /^(02|04|2)/.test(barcode.padStart(14, '0').slice(1))) return fail('Invalid or restricted explicit GTIN')
  if (!name || name !== plain(api.name || '') || barcode !== (typeof api.jan === 'string' ? api.jan.trim() : '') || !plain(api.net_amount || '') || !pack.startsWith(plain(api.net_amount))) return fail('Main name/JAN/contents disagree with official API')
  const image = html.match(source === 'myojo' ? /<figure class="ns-p-item__main__figure">\s*<img src="([^"]+)"/ : /<div class="ItemDetail__image -pc">\s*<img src="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&')
  if (!image || image !== api.image_url || new URL(image).origin !== 'https://cdn.nissin.com' || new URL(image).searchParams.get('id') !== id) return fail('Missing or mismatched official same-page main image')
  return { barcode, name, brand: typeof api.brand_label === 'string' ? plain(api.brand_label) : '', manufacturer: typeof api.company_label === 'string' ? plain(api.company_label) : '', manufacturerSlug: api.company_slug || '', pack, category: api.category_label || '', description: '', imageUrl: image, sourceUrl, catalogSource: source }
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
async function main() {
  await mkdir(out, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), complete: false, requests: [], delayMsPerOrigin: 2500, databaseWrites: false, scope: 'Only current Nissin group item index and Myojo official all-products list; no historical indexes, news or external shops.' }
  const last = new Map()
  async function get(url, robots = false) {
    const u = new URL(url)
    if (!Object.values(origins).includes(u.origin)) throw Error('External origin rejected')
    const file = `${out}/food-cache-${createHash('sha256').update(url).digest('hex')}.txt`
    try { return await readFile(file, 'utf8') } catch {}
    if (process.argv.includes('--offline')) throw Error(`Missing offline cache: ${url}`)
    await new Promise(r => setTimeout(r, Math.max(0, 2500 - (Date.now() - (last.get(u.origin) || 0))))); last.set(u.origin, Date.now())
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); report.requests.push({ url, status: r.status })
    if (robots && r.status === 404) { await writeFile(file, ''); return '' }
    if (!r.ok) throw Error(`HTTP ${r.status}: ${url}; stopped without retry`)
    const text = await r.text(); await writeFile(file, text); return text
  }
  async function list(source) {
    const rows = [], seen = new Set()
    for (let page = 1; ; page++) {
      const url = `${origins[source]}/api/v1.1/ja_jp/products/list?${source === 'myojo' ? 'company=myojofoods&' : ''}page=${page}&is_official=true`
      const data = JSON.parse(await get(url))
      if (!Array.isArray(data.products)) throw Error('Invalid official list data')
      if (data.products.some(r => seen.has(String(r.id)))) throw Error('Repeated official list page identity')
      data.products.forEach(r => seen.add(String(r.id))); rows.push(...data.products)
      if (data.products.length < 100) { report[`${source}ListPages`] = page; return rows }
    }
  }
  try {
    for (const origin of Object.values(origins)) {
      const robots = await get(origin + '/robots.txt', true)
      if (/Disallow:\s*\/(?:jp\/product|products|api)/i.test(robots) || /^Disallow:\s*\/\s*$/m.test(robots)) throw Error('Product routes disallowed by robots')
    }
    const index = await get(origins.nissin + '/jp/product/items/'), nissinUrls = directoryLinks(index)
    await get(origins.myojo + '/products/all/')
    const nissinList = await list('nissin'), myojoList = await list('myojo')
    const byId = new Map(nissinList.map(r => [String(r.id), r])), targets = nissinUrls.map(sourceUrl => ({ source: 'nissin', sourceUrl, listed: byId.get(new URL(sourceUrl).pathname.split('/').at(-2)) }))
    targets.push(...myojoList.map(listed => ({ source: 'myojo', sourceUrl: `${origins.myojo}/products/items/${listed.id}/`, listed })))
    report.nissinCurrentIndexProducts = nissinUrls.length; report.myojoCurrentProducts = myojoList.length; report.totalTargetUrls = targets.length
    await writeFile(`${out}/nissin-myojo-directory.json`, JSON.stringify({ scope: report.scope, nissinCurrentIndexProducts: nissinUrls.length, myojoCurrentProducts: myojoList.length, targets }, null, 2))
    console.log(JSON.stringify({ directoryComplete: true, nissin: nissinUrls.length, myojo: myojoList.length }))
    if (process.argv.includes('--directory-only')) return
    let known = new Set()
    try { known = new Set(JSON.parse(await readFile('artifacts/products-round7-2026-10-28/known-barcodes.json', 'utf8')).canonicalBarcodes) }
    catch (error) { if (error.code === 'ENOENT') report.knownSnapshotUnavailable = true; else throw error }
    const parsed = [], excluded = [], manufacturerCounts = {}; let processed = 0, skippedKnown = 0
    for (const target of targets) {
      const listedJan = typeof target.listed?.jan === 'string' ? target.listed.jan.trim() : ''
      if (listedJan && known.has(listedJan.padStart(14, '0'))) { skippedKnown++; continue }
      const html = await get(target.sourceUrl)
      const id = new URL(target.sourceUrl).pathname.split('/').filter(Boolean).at(-1)
      const apiUrl = target.listed?.href || `${origins.nissin}/api/v1/ja_jp/products/detail?id=${id}`
      const api = JSON.parse(await get(apiUrl)); manufacturerCounts[api.company_label || '(unlabelled)'] = (manufacturerCounts[api.company_label || '(unlabelled)'] || 0) + 1
      const row = parseProduct(html, api, target.sourceUrl, target.source)
      if (row.reason) excluded.push(row)
      else parsed.push(row)
      processed++; report.processed = processed; report.skippedKnown = skippedKnown; report.parsed = parsed.length; report.excludedCount = excluded.length; report.manufacturerCounts = manufacturerCounts
      if (processed % 20 === 0) { await writeFile(`${out}/nissin-progress.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ processed, parsed: parsed.length, skippedKnown, excluded: excluded.length })) }
    }
    const unique = uniqueProducts(parsed); excluded.push(...unique.excluded)
    const candidates = unique.rows.filter(r => !known.has(r.barcode.padStart(14, '0')))
    for (const source of Object.keys(origins)) await writeFile(`${out}/${source}.json`, JSON.stringify(candidates.filter(r => r.catalogSource === source), null, 2))
    report.complete = true; report.candidates = candidates.length; report.excluded = excluded; report.finalDeduplicationRequired = true
  } catch (error) { report.error = error.message; process.exitCode = 1 }
  finally { await writeFile(`${out}/nissin-report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ complete: report.complete, processed: report.processed, candidates: report.candidates, excluded: report.excluded?.length, error: report.error })) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
