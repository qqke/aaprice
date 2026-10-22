import { writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { catalogRows } from "./crawl-sundrug-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"

const origin = "https://sundrug-online.com"
const selectedHandles = ["dropship", "diy_top"]

export function selectCollections(collections) {
  if (!Array.isArray(collections)) throw Error("Invalid collections payload")
  return selectedHandles.map(handle => {
    const collection = collections.find(item => item.handle === handle)
    if (!collection || !Number.isInteger(collection.products_count) || collection.products_count < 1) throw Error(`Missing or invalid collection ${handle}`)
    return { handle, title: collection.title, listedProductCount: collection.products_count }
  })
}

export function acceptProducts(products, rows, existing) {
  if (!Array.isArray(products)) throw Error("Invalid collection products payload")
  let missingBarcode = 0
  for (const product of products) {
    if (!product.handle || !Array.isArray(product.variants)) throw Error("Invalid collection product")
    const normalized = catalogRows(product, `${origin}/products/${encodeURIComponent(product.handle)}`)
    if (!normalized.length) missingBarcode++
    for (const row of normalized) if (!existing.has(row.barcode) && !rows.has(row.barcode)) rows.set(row.barcode, row)
  }
  return missingBarcode
}

async function main() {
  const out = "artifacts/products-2026-10-22"
  const get = await createFetcher(`${out}/sundrug-collections-cache`, process.argv.includes("--offline"), process.argv.includes("--resume"))
  const snapshot = databaseProcess(process.env.AAPRICE_DB_URL, "\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(barcode),'[]'::json) from public.products;")
  const existing = new Set(JSON.parse(snapshot.slice(snapshot.indexOf("["))))
  const rows = new Map(), failures = [], coverage = []
  let blocked = false
  async function save() {
    await writeFile(`${out}/sundrug-collections.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/sundrug-collections-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), newProducts: rows.size, blocked, complete: coverage.length === 2 && coverage.every(item => item.complete) && !failures.length, coverage, failures }, null, 2))
  }
  try {
    let collections = []
    for (let page = 1; page <= 10; page++) {
      const payload = JSON.parse((await get(`${origin}/collections.json?limit=250&page=${page}`)).html)
      if (!Array.isArray(payload.collections)) throw Error("Invalid collections payload")
      collections.push(...payload.collections)
      if (selectedHandles.every(handle => collections.some(item => item.handle === handle))) break
      if (payload.collections.length < 250) break
    }
    const selected = selectCollections(collections)
    // One sequential pager per collection keeps total concurrency at two.
    await Promise.all(selected.map(async collection => {
      const progress = { ...collection, pages: 0, sourceProducts: 0, missingBarcodeProducts: 0, difference: collection.listedProductCount, complete: false }
      coverage.push(progress)
      for (let page = 1; page <= 100; page++) {
        const url = `${origin}/collections/${collection.handle}/products.json?limit=250&page=${page}`
        if (blocked) { failures.push({ url, reason: "Skipped after source rate limit" }); break }
        try {
          const payload = JSON.parse((await get(url)).html)
          progress.missingBarcodeProducts += acceptProducts(payload.products, rows, existing)
          progress.pages++
          progress.sourceProducts += payload.products.length
          progress.difference = progress.listedProductCount - progress.sourceProducts
          if (payload.products.length < 250) {
            progress.complete = progress.difference === 0
            if (!progress.complete) failures.push({ url, reason: `Collection count differs by ${progress.difference}: listed ${progress.listedProductCount}, fetched ${progress.sourceProducts}` })
            break
          }
          if (page === 100) failures.push({ url, reason: "Reached 25000 product pagination limit" })
          if (page % 10 === 0) { console.log(`${collection.handle}: ${page} pages; ${rows.size} new products total`); await save() }
        } catch (error) {
          failures.push({ url, reason: error.message })
          if (/429/.test(error.message)) blocked = true
          break
        }
      }
    }))
  } catch (error) {
    failures.push({ reason: error.message })
    if (/429/.test(error.message)) blocked = true
  } finally { await save() }
  console.log(JSON.stringify({ newProducts: rows.size, coverage, failures }))
  if (failures.length || coverage.some(item => !item.complete)) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
