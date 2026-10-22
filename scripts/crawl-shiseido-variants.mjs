import assert from 'node:assert/strict'
import {readFile, readdir, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher} from './crawl-national-stores.mjs'
import {validJan} from './crawl-drugstores.mjs'
import {parseShiseidoProduct} from './crawl-shiseido-products.mjs'
import {databaseProcess} from './sync-sundrug.mjs'

const origin = 'https://www.shiseido.co.jp'
const text = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
export function parseVariants(product, sourceUrl, base = {}) {
  assert(/^https:\/\/www\.shiseido\.co\.jp\/sw\/onlinestore\/products\/[A-Za-z0-9]+\.html$/.test(sourceUrl), 'Unexpected product URL')
  assert(product && typeof product.shohin_name === 'string' && product.shohin_name, 'Invalid product detail payload')
  const variants = []
  function visit(value) {
    if (Array.isArray(value)) { for (const item of value) visit(item); return }
    if (!value || typeof value !== 'object') return
    if (typeof value.sweb_shohin_cd === 'string') variants.push(value)
    for (const child of Object.values(value)) if (Array.isArray(child) || (child && typeof child === 'object')) visit(child)
  }
  visit(product.pattern_2_5_list)
  visit(product.pattern_3_list)
  variants.push(product)
  const rows = new Map()
  for (const variant of variants) {
    const barcode = text(variant.sweb_shohin_cd)
    if (!validJan(barcode) || rows.has(barcode)) continue
    const imagePath = text(variant.irodama_gzfl_pth)
    const photoPath = text(variant.shohin_pl_s_gzfl_pth_1)
    rows.set(barcode, {
      barcode, name: text(variant.shohin_zen_mei) || text(product.shohin_name),
      brand: text(product.brnd_mei) || base.brand || '', pack: text(variant.hyoji_yo_naiyo_ryo),
      category: text(product.birui_mei) || base.category || '',
      description: text(product.catch_copy_joho) || base.description || '',
      imageUrl: photoPath.startsWith('/products/') ? `https://imagecdn.shiseido.co.jp/c!/a=0,f=webp:jpg/resources/sw${photoPath}` : base.imageUrl || (imagePath.startsWith('/products/') ? `https://imagecdn.shiseido.co.jp/c!/a=0,f=webp:jpg/resources/sw${imagePath}` : ''),
      catalogSource: 'shiseido', sourceUrl: `${sourceUrl}?sweb_shohin_cd=${barcode}`,
    })
  }
  return [...rows.values()]
}

async function main() {
  const out = 'artifacts/products-round2-2026-10-22'
  const get = await createFetcher(`${out}/shiseido-cache`, process.argv.includes('--offline'), process.argv.includes('--resume'))
  const priorRoot = 'artifacts/products-2026-10-22'
  const report = JSON.parse(await readFile(`${priorRoot}/shiseido-report.json`, 'utf8'))
  const urls = new Map(report.failures.map(item => [item.url, {}]))
  for (const file of await readdir(`${priorRoot}/shiseido-cache/cache`)) {
    const cached = JSON.parse(await readFile(`${priorRoot}/shiseido-cache/cache/${file}`, 'utf8'))
    if (!/\/products\/[A-Za-z0-9]+\.html$/.test(cached.url)) continue
    urls.set(cached.url, parseShiseidoProduct(cached.html, cached.url))
  }
  const raw = databaseProcess(process.env.AAPRICE_DB_URL, '\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(barcode) from public.products;')
  const existing = new Set(JSON.parse(raw)), rows = new Map(), failures = [], recoveredLinks = [], observed = new Set()
  const entries = [...urls], failedBefore = new Set(report.failures.map(item => item.url))
  let next = 0, completed = 0, blocked = false
  async function save() {
    await writeFile(`${out}/shiseido.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/shiseido-report.json`, JSON.stringify({generatedAt: new Date().toISOString(), discovered: entries.length,
      attempted: completed, observedUniqueJans: observed.size, newProducts: rows.size, complete: completed === entries.length && !failures.length,
      imagePolicy: 'Prefer API variant product photo, then official HTML JSON-LD representative photo; public shade swatch only when neither product photo exists',
      sourceUrlPolicy: 'Variant query parameter sweb_shohin_cd is used by official main.js product links',
      recoveredLinks, failures, databaseApplied: false}, null, 2))
  }
  await Promise.all(Array.from({length: 2}, async () => {
    while (next < entries.length && !blocked) {
      const [url, base] = entries[next++], id = url.match(/products\/(\w+)\.html$/)[1]
      try {
        const apiUrl = `${origin}/sw/api/auth/V1/SWFR070220.seam?shohin_pl_c_cd=${id}`
        const payload = JSON.parse((await get(apiUrl)).html)
        const variants = parseVariants(payload, url, base)
        if (!variants.length) throw Error('No verified JAN variants')
        for (const row of variants) { observed.add(row.barcode); if (!existing.has(row.barcode)) rows.set(row.barcode, row) }
        if (failedBefore.has(url)) recoveredLinks.push({url, verifiedJans: variants.map(row => row.barcode)})
      } catch (error) {
        failures.push({url, reason: error.message})
        if (/429/.test(error.message)) blocked = true
      }
      completed++
      if (completed % 50 === 0) { console.log(`Shiseido variants ${completed}/${entries.length}: ${rows.size} new, ${observed.size} total JANs, ${failures.length} failed`); await save() }
    }
  }))
  await save()
  console.log(JSON.stringify({attempted: completed, observedUniqueJans: observed.size, newProducts: rows.size, recoveredLinks, failures}))
  if (completed !== entries.length || failures.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
