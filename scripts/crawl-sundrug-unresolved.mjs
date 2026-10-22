import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { catalogRows } from "./crawl-sundrug-products.mjs"

export function normalizePublicProduct(product, sourceUrl) {
  if (!product?.title || !Array.isArray(product.variants) || decodeURIComponent(new URL(sourceUrl).pathname.split("/").at(-1)) !== product.handle) throw Error("Invalid product detail")
  return catalogRows({ ...product, body_html: product.description, product_type: product.type,
    images: (product.images || []).map(src => ({ src: src.startsWith("//") ? `https:${src}` : src })) }, sourceUrl)
}

async function main() {
  const out = "artifacts/products-round3-2026-10-22"
  const get = await createFetcher(`${out}/sundrug-cache`, process.argv.includes("--offline"), true)
  const prior = JSON.parse(await readFile("artifacts/products-round2-2026-10-22/sundrug-report.json", "utf8"))
  const urls = [...new Set(prior.missingGtinUrls)], rows = new Map(), rejected = [], failures = []
  let attempted = 0, next = 0, blocked = false
  async function save() {
    await writeFile(`${out}/sundrug.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/sundrug-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), requested: urls.length,
      attempted, accepted: rows.size, complete: attempted === urls.length && !failures.length, blocked, rejected, failures }, null, 2))
  }
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < urls.length && !blocked) {
      const url = urls[next++]
      try {
        const product = JSON.parse((await get(`${url}.js`)).html)
        const normalized = normalizePublicProduct(product, url)
        if (!normalized.length) rejected.push({ url, reason: "No valid variant barcode, SKU or handle", title: product.title,
          variants: product.variants.map(v => ({ barcode: v.barcode, sku: v.sku })) })
        for (const row of normalized) rows.set(row.barcode, row)
      } catch (error) {
        failures.push({ url, reason: error.message })
        if (/429/.test(error.message)) { blocked = true; await new Promise(resolve => setTimeout(resolve, 30000)) }
      }
      attempted++
      if (attempted % 50 === 0) console.log(`Sundrug public details ${attempted}/${urls.length}: ${rows.size} valid products`)
    }
  }))
  await save()
  console.log(JSON.stringify({ requested: urls.length, attempted, accepted: rows.size, rejected: rejected.length, failures: failures.length, blocked }))
  if (failures.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
