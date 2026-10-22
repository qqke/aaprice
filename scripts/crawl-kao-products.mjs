import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {validJan} from './crawl-drugstores.mjs'
import {createFetcher} from './crawl-national-stores.mjs'

export const catalogUrl = 'https://www.kao-kirei.com/content/wcm_kao/sites/kao/www-kao-kirei-com/jp/ja/mkm/json-common/product-list/_jcr_content/root/responsivegrid/kirei_product_model.model.json'
const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

export function parseKaoCatalog(payload) {
  assert(Array.isArray(payload?.productList) && payload.productList.length, 'Empty or invalid Kao catalog')
  const rows = new Map(), rejected = []
  for (const product of payload.productList) {
    const barcode = text(product.janCode), name = text(product.dispName), sourceUrl = text(product.pageUrl)
    if (!name || !validJan(barcode) || !sourceUrl.startsWith('https://www.kao-kirei.com/ja/item/') || new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1) !== barcode) {
      rejected.push({barcode, name, reason: 'Missing name, invalid JAN or mismatched official product URL'})
      continue
    }
    const image = text(product.images?.src), imageUrl = image.startsWith('//') ? `https:${image}` : image
    if (!rows.has(barcode)) rows.set(barcode, {
      barcode, name, brand: text(product.brand?.dispName), pack: '', category: text(product.category?.dispName),
      description: '', imageUrl: /^https:\/\//.test(imageUrl) ? imageUrl : '', catalogSource: 'kao', sourceUrl,
    })
  }
  return {rows: [...rows.values()], rejected, sourceRows: payload.productList.length,
    discontinuedRows: payload.productList.filter(product => product.expiredProductsFlag === true).length}
}

async function main() {
  const out = process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || 'artifacts/products-2026-10-22'
  const get = await createFetcher(out, process.argv.includes('--offline'), process.argv.includes('--resume'))
  const saved = await get(catalogUrl), parsed = parseKaoCatalog(JSON.parse(saved.html))
  await writeFile(`${out}/kao.json`, JSON.stringify(parsed.rows, null, 2))
  const report = {sourceUrl: catalogUrl, collectedAt: saved.collectedAt, sourceRows: parsed.sourceRows,
    accepted: parsed.rows.length, duplicateRows: parsed.sourceRows - parsed.rejected.length - parsed.rows.length,
    discontinuedRows: parsed.discontinuedRows, discontinuedPolicy: 'Retained as catalog identities; no stock or price claims',
    rejected: parsed.rejected, databaseApplied: false}
  await writeFile(`${out}/kao-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({...report, rejected: report.rejected.length}))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
