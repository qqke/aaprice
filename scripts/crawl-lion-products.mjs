import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher} from './crawl-national-stores.mjs'
import {validGtin} from './import-new-products.mjs'

const origin = 'https://map.lion.co.jp'
const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
export function parseLionProduct(product, id) {
  assert(product?.id === id && Array.isArray(product.children), 'Invalid Lion product detail')
  const rows = [], rejected = []
  // The parent name groups variants; only children explicitly identify the full retail product.
  for (const variant of product.children) {
    const barcode = text(variant.jan), name = text(variant.name)
    if (!validGtin(barcode) || !name) { rejected.push({barcode, name}); continue }
    const image = text(variant.image_url) || text(product.image_url)
    rows.push({barcode, name, brand: '', pack: '', category: '', description: '',
      imageUrl: image.startsWith('//') ? `https:${image}` : /^https:\/\//.test(image) ? image : '',
      catalogSource: 'lion', sourceUrl: `${origin}/?product=${id}`})
  }
  return {rows, rejected}
}

async function main() {
  const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'artifacts/products-round3-2026-10-22'
  const get = await createFetcher(`${out}/lion-cache`, process.argv.includes('--offline'), process.argv.includes('--resume'))
  const products = new Map(), rows = new Map(), failures = [], rejected = []
  let total = 0
  for (let page = 1; ; page++) {
    const payload = JSON.parse((await get(`${origin}/api/product?l=100&p=${page}`)).html)
    assert(Number.isInteger(payload.total) && Array.isArray(payload.items), 'Invalid Lion list')
    if (page === 1) total = payload.total
    assert(payload.total === total, 'Lion list count changed during crawl')
    const before = products.size
    for (const product of payload.items) products.set(product.id, product)
    if (products.size >= total) break
    assert(products.size > before, 'Lion list repeated before total reached')
  }
  let next = 0, completed = 0, blocked = false
  const ids = [...products.keys()]
  async function save() {
    await writeFile(`${out}/lion.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/lion-report.json`, JSON.stringify({generatedAt: new Date().toISOString(),
      catalogUrl: `${origin}/api/product`, listedParents: total, discoveredParents: ids.length,
      attempted: completed, acceptedUniqueGtins: rows.size, rejected, failures,
      complete: completed === total && !failures.length, databaseApplied: false,
      policy: 'Only explicit child JAN and child full names; no parent-only identity guesses',
      imagePolicy: 'Child image when supplied; otherwise official parent representative image, not a verified variant image'}, null, 2))
  }
  await Promise.all(Array.from({length: 2}, async () => {
    while (next < ids.length && !blocked) {
      const id = ids[next++]
      try {
        const payload = JSON.parse((await get(`${origin}/api/product/${id}`)).html)
        const parsed = parseLionProduct(payload, id)
        rejected.push(...parsed.rejected)
        for (const row of parsed.rows) if (!rows.has(row.barcode.padStart(14, '0'))) rows.set(row.barcode.padStart(14, '0'), row)
      } catch (error) { failures.push({id, reason: error.message}); if (/429/.test(error.message)) blocked = true }
      completed++
      if (completed % 25 === 0) { await save(); console.log(`Lion ${completed}/${total}: ${rows.size} valid GTINs`) }
    }
  }))
  await save()
  if (completed !== total || failures.length) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {console.error(error.message); process.exitCode = 1})
