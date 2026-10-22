import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher} from './crawl-national-stores.mjs'
import {validGtin} from './import-new-products.mjs'
import {databaseProcess} from './sync-sundrug.mjs'

const origin = 'https://map.unicharm.co.jp'
const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
export function parseUnicharmProduct(product, id) {
  assert(product?.id === id && Array.isArray(product.children), 'Invalid Unicharm detail')
  const rows = [], rejected = []
  for (const child of product.children) {
    const barcode = text(child.jan), name = text(child.name)
    if (!validGtin(barcode) || !name) { rejected.push({barcode, name}); continue }
    const image = text(child.image_url)
    rows.push({barcode, name, brand: '', pack: '', category: '', description: '',
      imageUrl: image.startsWith('https://') ? image : '', catalogSource: 'unicharm',
      sourceUrl: `${origin}/?product=${encodeURIComponent(id)}`})
  }
  return {rows, rejected}
}

async function main() {
  const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'artifacts/products-round4-2026-10-22'
  const get = await createFetcher(`${out}/unicharm-cache`, process.argv.includes('--offline'), true)
  const existing = new Set(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL,
    '\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(lpad(barcode,14,\'0\')) from public.products;')))
  const products = new Map(), rows = new Map(), failures = [], rejected = [], excludedParents = []
  let total = 0, listed = 0
  for (let page = 1; ; page++) {
    const payload = JSON.parse((await get(`${origin}/api/product?l=100&p=${page}`)).html)
    assert(Number.isInteger(payload.total) && Array.isArray(payload.items), 'Invalid Unicharm list')
    if (page === 1) total = payload.total
    assert(payload.total === total, 'Catalog total changed')
    assert(payload.items.length || listed >= total, 'List ended before expected count')
    listed += payload.items.length
    for (const p of payload.items) {
      if (!text(p.id)) { excludedParents.push(p); continue }
      assert(!products.has(p.id), 'Repeated parent before list completion')
      products.set(p.id, p)
    }
    if (listed >= total) break
  }
  assert(listed === total, 'List total mismatch')
  let next = 0, attempted = 0, blocked = false
  const ids = [...products.keys()]
  async function save() {
    const all = [...rows.values()], fresh = all.filter(r => !existing.has(r.barcode.padStart(14, '0')))
    await writeFile(`${out}/unicharm.json`, JSON.stringify(fresh, null, 2))
    await writeFile(`${out}/unicharm-report.json`, JSON.stringify({generatedAt: new Date().toISOString(),
      catalogUrl: `${origin}/api/product`, listedParents: total, validParents: ids.length, excludedParents,
      attempted, acceptedUniqueGtins: all.length, newProducts: fresh.length, rejected, failures,
      complete: attempted === ids.length && !failures.length, databaseApplied: false,
      scope: 'Public store-locator catalog; not every historical Unicharm product'}, null, 2))
  }
  await Promise.all(Array.from({length: 2}, async () => {
    while (next < ids.length && !blocked) {
      const id = ids[next++]
      try {
        const parsed = parseUnicharmProduct(JSON.parse((await get(`${origin}/api/product/${encodeURIComponent(id)}`)).html), id)
        rejected.push(...parsed.rejected)
        for (const r of parsed.rows) rows.set(r.barcode.padStart(14, '0'), r)
      } catch (e) { failures.push({id, reason: e.message}); if (/429|403/.test(e.message)) blocked = true }
      attempted++
      if (attempted % 25 === 0) { await save(); console.log(`Unicharm ${attempted}/${ids.length}: ${rows.size} GTINs`) }
    }
  }))
  await save()
  if (attempted !== ids.length || failures.length) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => {console.error(e.message); process.exitCode = 1})
