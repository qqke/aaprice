import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { validGtin } from './import-new-products.mjs'
import { databaseProcess } from './sync-sundrug.mjs'

const origin = 'https://www.fujiyaku-direct.com'
const out = 'artifacts/products-round6-fujiyaku-2026-10-28'
const plain = value => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(x[\da-f]+|\d+);/gi, (entity, code) => { const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return point <= 0x10ffff ? String.fromCodePoint(point) : entity }).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
export function parseProduct(html, sourceUrl) {
  html = html.split('<div class="pane-goods-footer">')[0]
  const name = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '')
  if (!name) return { reason: 'Missing product heading' }
  let meta = {}
  try { meta = JSON.parse((html.match(/<meta property="etm:goods_detail" content="([^"]*)"/)?.[1] || '{}').replace(/&quot;/g, '"').replace(/&amp;/g, '&')) } catch {}
  if (meta.regular === '1' || meta.set_fg === '1' || /定期|まとめ買い|\d+個セット|\d+本セット|\d+袋セット/.test(name)) return { reason: 'Subscription or shop bundle', name }
  const goods = new URL(sourceUrl).pathname.match(/^\/shop\/g\/g([^/]+)\/$/)?.[1]
  if (!goods || meta.goods !== goods) return { reason: 'Product metadata identity mismatch', name }
  const detail = [...html.matchAll(/<dl class="goods-detail-description block-goods-spec">([\s\S]*?)<\/dl>/g)].map(m => plain(m[1])).join(' ')
  const jan = [...detail.matchAll(/JANコード\s*[:：]?\s*([\d\s、,/／・]+)/g)].flatMap(m => m[1].match(/(?<!\d)\d{8,14}(?!\d)/g) || [])
  if (new Set(jan).size !== 1) return { reason: 'Missing or ambiguous explicit JAN', name }
  const barcode = jan[0], identity = barcode.padStart(14, '0'), prefix = identity.slice(1)
  if (!validGtin(barcode) || /^(?:02|04|2)/.test(prefix) || /^0{5}[02]\d{7}$/.test(prefix)) return { reason: 'Invalid or restricted GTIN', name, barcode }
  const mainImage = html.match(/<li class="block-goods-gallery--src-l">\s*<a\b[^>]*href="([^"]+)"/i)?.[1]
  const imageUrl = mainImage ? new URL(mainImage.replace(/&amp;/g, '&'), origin).href : ''
  if (!imageUrl.startsWith(`${origin}/img/goods/L/`)) return { reason: 'Missing official main product image', name, barcode }
  if (new URL(imageUrl).pathname.split('/').at(-1).replace(/\.[^.]+$/, '') !== goods) return { reason: 'Main image product identity mismatch', name, barcode }
  return { barcode, name, brand: meta.brand_name || '富士薬品', pack: meta.variation_name1 || '', category: meta.category_name || '', description: '', imageUrl, catalogSource: 'fujiyaku', sourceUrl }
}
export function uniqueProducts(products) {
  const groups = new Map(), rows = new Map(), excluded = []
  for (const product of products) {
    const key = product.barcode.padStart(14, '0')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(product)
  }
  for (const [key, group] of groups) {
    if (group.some(p => p.name !== group[0].name || p.pack !== group[0].pack)) excluded.push(...group.map(p => ({ ...p, reason: 'Conflicting product identities for same JAN' })))
    else rows.set(key, group[0])
  }
  return { rows, excluded }
}
export function links(html, pattern) {
  return [...new Set([...html.matchAll(/href=["']([^"']+)/g)].map(m => new URL(m[1].replace(/&amp;/g, '&'), origin)).filter(u => u.origin === origin && pattern.test(u.pathname)).map(u => u.href))]
}
async function main() {
  await mkdir(out, { recursive: true })
  let last = 0
  async function get(url, file) {
    try { return await readFile(`${out}/${file}`, 'utf8') } catch {}
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 2100 - (Date.now() - last))))
    last = Date.now()
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw Error(`${url}: HTTP ${response.status}; stopped without retry`)
    const html = await response.text()
    await writeFile(`${out}/${file}`, html)
    return html
  }
  const robots = await get(`${origin}/robots.txt`, 'robots.txt')
  if (/Disallow:\s*\S|Crawl-delay:/i.test(robots)) throw Error('Review changed robots rules before crawling')
  const queue = ['/shop/c/cm-list/', '/shop/c/ch-list/', '/shop/c/cs-list/'].map(p => origin + p)
  const visited = new Set(), products = new Set(), counts = {}
  while (queue.length) {
    const url = queue.shift()
    if (visited.has(url)) continue
    const html = await get(url, `listing-${new URL(url).pathname.split('/').at(-2)}.html`)
    visited.add(url)
    counts[url] = html.match(/全(\d+)件中/)?.[1] || null
    links(html, /^\/shop\/g\/[^/]+\/$/).forEach(u => products.add(u))
    links(html, /^\/shop\/c\/c(?:m-list|h-list|s-list)(?:_p\d+)?\/$/).forEach(u => { if (!visited.has(u)) queue.push(u) })
  }
  await writeFile(`${out}/directory.json`, JSON.stringify({ pages: [...visited], counts, productUrls: [...products] }, null, 2))
  const parsed = [], excluded = []
  let fetched = 0
  for (const url of products) {
    const product = parseProduct(await get(url, `product-${new URL(url).pathname.split('/').at(-2)}.html`), url)
    if (product.reason) excluded.push({ sourceUrl: url, ...product })
    else parsed.push(product)
    fetched++
    if (fetched % 20 === 0) console.log(JSON.stringify({ fetched, total: products.size, parsed: parsed.length, excluded: excluded.length }))
  }
  const { rows, excluded: conflicts } = uniqueProducts(parsed)
  excluded.push(...conflicts)
  const existing = new Set(databaseProcess(process.env.AAPRICE_DB_URL, "select lpad(barcode,14,'0') from public.products where barcode ~ '^([0-9]{8}|[0-9]{12,14})$';").split(/\s+/))
  const candidates = [...rows].filter(([key]) => !existing.has(key)).map(([,value]) => value)
  await writeFile(`${out}/fujiyaku.json`, JSON.stringify(candidates, null, 2))
  await writeFile(`${out}/report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), directoryPages: visited.size, discoveredProductUrls: products.size, fetched, validUnique: rows.size, candidates: candidates.length, skippedExisting: rows.size - candidates.length, excluded, counts, completeForThreePublicCategories: true, databaseWrites: false, delayMs: 2100 }, null, 2))
  console.log(JSON.stringify({ fetched, validUnique: rows.size, candidates: candidates.length, excluded: excluded.length }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
