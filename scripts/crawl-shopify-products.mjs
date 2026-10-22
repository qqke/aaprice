import { writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { catalogRows } from "./crawl-sundrug-products.mjs"

const sources = { sugi: "https://sugi-drug.com", qols: "https://qol-shop.jp" }

export function normalizeCatalog(products, source, origin) {
  if (sources[source] !== origin) throw Error("Unexpected catalog source")
  return products.flatMap(product => catalogRows(product, `${origin}/products/${encodeURIComponent(product.handle)}`)
    .map(row => ({ ...row, catalogSource: source })))
}

async function main() {
  const out = process.argv.find(arg => arg.startsWith("--out="))?.slice(6) || "artifacts/products-2026-10-22"
  await Promise.all(Object.entries(sources).map(async ([source, origin]) => {
    const get = await createFetcher(`${out}/${source}-cache`, process.argv.includes("--offline"), process.argv.includes("--resume"))
    const rows = new Map()
    const missingBarcodes = []
    const failures = []
    let blocked = false
    let sourceProducts = 0, pages = 0, complete = false
    for (let page = 1; page <= 100; page++) {
      const url = `${origin}/products.json?limit=250&page=${page}`
      let data
      try {
        data = JSON.parse((await get(url)).html)
        if (!Array.isArray(data.products)) throw Error(`Invalid ${source} catalog`)
      } catch (error) {
        failures.push({ url, reason: error.message })
        blocked = /429/.test(error.message)
        break
      }
      sourceProducts += data.products.length
      pages++
      for (const row of normalizeCatalog(data.products, source, origin)) if (!rows.has(row.barcode)) rows.set(row.barcode, row)
      missingBarcodes.push(...data.products.filter(product => !normalizeCatalog([product], source, origin).length))
      console.log(`${source}: ${pages} pages, ${rows.size} valid products`)
      if (data.products.length < 250) { complete = true; break }
    }
    let next = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < missingBarcodes.length) {
        const product = missingBarcodes[next++]
        if (blocked) { failures.push({ handle: product.handle, reason: "Skipped after rate limit" }); continue }
        // Shopify list responses omit barcode; the public product JSON supplies it.
        try {
          const detail = JSON.parse((await get(`${origin}/products/${encodeURIComponent(product.handle)}.js`)).html)
          if (!Array.isArray(detail.variants)) throw Error(`Invalid ${source} product detail`)
          for (const row of normalizeCatalog([{ ...product, variants: detail.variants }], source, origin)) if (!rows.has(row.barcode)) rows.set(row.barcode, row)
        } catch (error) {
          failures.push({ handle: product.handle, reason: error.message })
          if (/429/.test(error.message)) blocked = true
        }
      }
    }))
    await writeFile(`${out}/${source}.json`, JSON.stringify([...rows.values()], null, 2))
    const report = { source, origin, fetchedAt: new Date().toISOString(), sourceProducts, pages, validProducts: rows.size, complete: complete && !failures.length, failures }
    await writeFile(`${out}/${source}-report.json`, JSON.stringify(report, null, 2))
    if (!report.complete) { console.error(`${source}: coverage incomplete; see report`); process.exitCode = 1 }
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
