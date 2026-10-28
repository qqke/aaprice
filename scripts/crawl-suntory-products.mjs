import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { validGtin } from './import-new-products.mjs'

const origin = 'https://products.suntory.co.jp', out = 'artifacts/products-round8-2026-10-28'
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const p = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return p <= 0x10ffff ? String.fromCodePoint(p) : '' }).replace(/&(amp|nbsp|quot|apos|lt|gt|times);/g, (_, n) => ({ amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', times: '×' })[n]).replace(/\s+/g, ' ').trim()
const canonicalUrl = u => { const url = new URL(u, origin); url.hash = ''; if (/^\/d\/\d+$/.test(url.pathname)) url.pathname += '/'; return url.href }
export function links(html) {
  return [...new Set([...html.matchAll(/href=["']([^"']+)["']/g)].map(m => canonicalUrl(m[1].replace(/&amp;/g, '&'))).filter(u => new URL(u).origin === origin))]
}
export function parseProduct(html, sourceUrl) {
  const fail = reason => ({ sourceUrl, reason })
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
  if (!canonical || canonicalUrl(canonical) !== sourceUrl) return fail('Canonical identity mismatch')
  const standard = [...html.matchAll(/<dl id="product_detail_standard">([\s\S]*?)<\/dl>/g)]
  if (standard.length !== 1) return fail('Missing or multiple main identity tables')
  const fields = [...standard[0][1].matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].map(m => [plain(m[1]), plain(m[2])])
  if (['JANコード', '容量'].some(k => fields.filter(([key]) => key === k).length !== 1)) return fail('Missing or ambiguous main JAN/capacity')
  const barcode = fields.find(([key]) => key === 'JANコード')[1], pack = fields.find(([key]) => key === '容量')[1]
  if (!/^(?:\d{8}|\d{12,14})$/.test(barcode) || !validGtin(barcode) || /^(02|04|2)/.test(barcode.padStart(14, '0').slice(1))) return fail('Invalid or restricted explicit GTIN')
  const name = plain(html.match(/<div id="product">\s*<h2>([\s\S]*?)<\/h2>/)?.[1] || '')
  const image = html.match(/<p id="product_img"><img src="([^"]+)" alt="([^"]*)"/)
  if (!name || !pack || !image || plain(image[2]) !== name || !image[1].startsWith('https://www.suntory.co.jp/products/pimg/')) return fail('Missing or mismatched native name/capacity/main image')
  const schemas = []
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const value = JSON.parse(m[1]); schemas.push(...(Array.isArray(value) ? value : [value])) } catch { return fail('Invalid structured identity metadata') }
  }
  const products = schemas.filter(s => s['@type'] === 'Product')
  if (products.length !== 1) return fail('Missing or multiple structured product identities')
  const p = products[0], schemaJan = p.gtin13 || p.gtin12 || p.gtin14 || p.gtin8
  if (schemaJan !== barcode || plain(p.name || '') !== name || canonicalUrl(p.url || '/') !== sourceUrl || new URL(p.image || origin).pathname !== new URL(image[1]).pathname) return fail('Main fields disagree with structured product identity')
  return { barcode, name, brand: typeof p.brand?.name === 'string' ? plain(p.brand.name) : '', pack, category: '', description: '', imageUrl: image[1].replace(/&amp;/g, '&'), sourceUrl, catalogSource: 'suntory' }
}
export function uniqueProducts(products) {
  const rows = new Map(), excluded = [], conflicts = new Set()
  for (const row of products) {
    const key = row.barcode.padStart(14, '0'), previous = rows.get(key)
    if (conflicts.has(key)) excluded.push({ ...row, reason: 'Conflicting JAN identity' })
    else if (previous && (previous.name !== row.name || previous.pack !== row.pack)) { rows.delete(key); conflicts.add(key); excluded.push({ ...previous, reason: 'Conflicting JAN identity' }, { ...row, reason: 'Conflicting JAN identity' }) }
    else rows.set(key, row)
  }
  return { rows: [...rows.values()], excluded }
}
async function main() {
  await mkdir(out, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), complete: false, requests: [], databaseWrites: false, delayMs: 2500, scope: 'Current same-site homepage brand/category links plus five public nutrition tables. External health shops and historical discontinued indexes excluded; no claim about unlinked products.' }
  let last = 0
  const cache = url => `${out}/suntory-cache-${createHash('sha256').update(url).digest('hex')}.html`
  async function get(url) {
    if (new URL(url).origin !== origin) throw Error('External origin rejected')
    try { return await readFile(cache(url), 'utf8') } catch {}
    if (process.argv.includes('--offline')) throw Error(`Missing offline cache: ${url}`)
    await new Promise(r => setTimeout(r, Math.max(0, 2500 - (Date.now() - last)))); last = Date.now()
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); report.requests.push({ url, status: r.status })
    if (!r.ok) throw Error(`HTTP ${r.status}: ${url}; stopped without retry`)
    const html = new TextDecoder('shift_jis').decode(await r.arrayBuffer()); await writeFile(cache(url), html); return html
  }
  try {
    const robots = await get(origin + '/robots.txt')
    if (/Disallow:\s*\/d(?:\/|\s|$)|Disallow:\s*\/\s*$/m.test(robots)) throw Error('Product paths disallowed by robots')
    const home = await get(origin + '/'), homeLinks = links(home)
    const directory = u => /^\/b\//.test(new URL(u).pathname) || /^\/\d{10}\/index\.html$/.test(new URL(u).pathname)
    const queue = homeLinks.filter(directory)
    queue.push(...['/softdrink/ingredient.html', '/beer/ingredient.html', '/rtd/ingredient.html', '/ingredient/ingredient01.html', '/ingredient/ingredient02.html'].map(p => origin + p))
    const visited = new Set(), products = new Set(), counts = {}
    while (queue.length) {
      const url = queue.shift(); if (visited.has(url)) continue
      const found = links(await get(url)); visited.add(url)
      const detail = found.filter(u => /^\/d\/\d+\/$/.test(new URL(u).pathname)); counts[url] = detail.length
      detail.forEach(u => products.add(u)); found.filter(directory).forEach(u => { if (!visited.has(u)) queue.push(u) })
      report.directoryPages = visited.size; report.discoveredProducts = products.size
      if (visited.size % 20 === 0) { await writeFile(`${out}/suntory-progress.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ directoryPages: visited.size, discoveredProducts: products.size })) }
    }
    report.directoryPages = visited.size; report.discoveredProducts = products.size
    await writeFile(`${out}/suntory-directory.json`, JSON.stringify({ pages: [...visited], productUrls: [...products], counts, scope: report.scope }, null, 2))
    console.log(JSON.stringify({ directoryComplete: true, directoryPages: visited.size, discoveredProducts: products.size }))
    if (process.argv.includes('--directory-only')) return
    let known = new Set()
    try { known = new Set(JSON.parse(await readFile('artifacts/products-round7-2026-10-28/known-barcodes.json', 'utf8')).canonicalBarcodes) }
    catch (error) { if (error.code === 'ENOENT') report.knownSnapshotUnavailable = true; else throw error }
    const parsed = [], excluded = []; let skippedKnownRoute = 0, fetched = 0
    for (const url of products) {
      const routeCode = new URL(url).pathname.split('/')[2]
      if (known.has(routeCode.padStart(14, '0'))) { skippedKnownRoute++; continue }
      const row = parseProduct(await get(url), url); fetched++
      if (row.reason) excluded.push(row); else parsed.push(row)
      report.fetched = fetched; report.skippedKnownRoute = skippedKnownRoute; report.parsed = parsed.length
      if (fetched % 20 === 0) { await writeFile(`${out}/suntory-progress.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ fetched, total: products.size, parsed: parsed.length, skippedKnownRoute })) }
    }
    const unique = uniqueProducts(parsed); excluded.push(...unique.excluded)
    const candidates = unique.rows.filter(r => !known.has(r.barcode.padStart(14, '0')))
    report.candidates = candidates.length; report.excluded = excluded; report.complete = true; report.knownSnapshot = 'round7/known-barcodes.json; final importer must recheck current database'
    await writeFile(`${out}/suntory.json`, JSON.stringify(candidates, null, 2))
  } catch (error) { report.error = error.message; process.exitCode = 1 }
  finally { await writeFile(`${out}/suntory-report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ complete: report.complete, directoryPages: report.directoryPages, discoveredProducts: report.discoveredProducts, fetched: report.fetched, candidates: report.candidates, excluded: report.excluded?.length, error: report.error })) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
