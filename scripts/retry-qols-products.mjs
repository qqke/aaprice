import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { catalogRows } from "./crawl-sundrug-products.mjs"

export function normalizeQols(product, handle) {
  if (!product?.title || !Array.isArray(product.variants) || product.handle !== handle) throw Error("Invalid QOLS product detail")
  return catalogRows({ ...product, body_html: product.description, product_type: product.type,
    images: (product.images || []).map(src => ({ src })) }, `https://qol-shop.jp/products/${encodeURIComponent(handle)}`)
    .map(row => ({ ...row, catalogSource: "qols" }))
}

async function main() {
  const out = "artifacts/products-round2-2026-10-22"
  const get = await createFetcher(`${out}/qols-cache`, process.argv.includes("--offline"), true)
  const prior = JSON.parse(await readFile("artifacts/products-2026-10-22/qols-report.json", "utf8"))
  const handles = [...new Set(prior.failures.map(item => item.handle).filter(Boolean))]
  const rows = new Map(), failures = [], rejected = []
  let attempted = 0, blocked = false
  for (const handle of handles) {
    if (blocked) { failures.push({ handle, reason: "Skipped after rate limit" }); continue }
    try {
      const product = JSON.parse((await get(`https://qol-shop.jp/products/${encodeURIComponent(handle)}.js`)).html)
      const normalized = normalizeQols(product, handle)
      if (!normalized.length) rejected.push({ handle, reason: "No valid GTIN" })
      for (const row of normalized) rows.set(row.barcode, row)
    } catch (error) {
      failures.push({ handle, reason: error.message })
      if (/429/.test(error.message)) blocked = true
    }
    attempted++
    await writeFile(`${out}/qols.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/qols-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), requested: handles.length, attempted,
      accepted: rows.size, complete: attempted === handles.length && !failures.length, failures, rejected }, null, 2))
    if (attempted % 10 === 0) console.log(`QOLS retry ${attempted}/${handles.length}: ${rows.size} valid products`)
  }
  // Save skipped requests too when rate limiting stops the loop.
  await writeFile(`${out}/qols-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), requested: handles.length, attempted,
    accepted: rows.size, complete: attempted === handles.length && !failures.length, failures, rejected }, null, 2))
  if (failures.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
