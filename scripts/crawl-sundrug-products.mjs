import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { databaseProcess, normalizeProduct } from "./sync-sundrug.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"

export const sitemapLocations = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].replaceAll("&amp;", "&"))
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

export function validBarcode(value) {
  if (!/^(?:\d{8}|\d{12,14})$/.test(value)) return false
  const digits = [...value].map(Number)
  const check = digits.pop()
  return (10 - digits.reverse().reduce((sum, digit, index) => sum + digit * (index % 2 ? 1 : 3), 0) % 10) % 10 === check
}

export function catalogRows(product, sourceUrl) {
  const prepared = { ...product, tags: Array.isArray(product.tags) ? product.tags : String(product.tags || "").split(",").map(text) }
  const priced = new Map(normalizeProduct(prepared).map((row) => [row.barcode, row]))
  return (product.variants || []).flatMap((variant) => {
    const barcode = [variant.barcode, variant.sku, product.handle].map(text).find(validBarcode)
    if (!barcode || !text(product.title)) return []
    const known = priced.get(barcode)
    return [{
      barcode, name: known?.name || text(product.title), brand: known?.brand || text(product.vendor),
      pack: known?.pack ?? (/^(?:Default Title|\d+)$/i.test(text(variant.title)) ? "" : text(variant.title)),
      category: known?.category || text(product.product_type) || prepared.tags.filter((tag) => !/^(?:NEW|常温|メーカー直送|【セルフメディケーション税制対象】)$/.test(tag)).at(-1) || "",
      description: known?.description || text(String(product.body_html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")).slice(0, 2000),
      imageUrl: known?.imageUrl || (/^https?:\/\//.test(product.images?.[0]?.src || "") ? product.images[0].src : ""),
      catalogSource: "sundrug", sourceUrl,
    }]
  })
}

async function parallel(items, operation, concurrency = 2) {
  let next = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) { const index = next++; await operation(items[index], index) }
  }))
}

async function main() {
  const out = "artifacts/products-2026-10-22"
  const cachedOnly = process.argv.includes("--cached-only")
  let blocked = false
  await mkdir(`${out}/sundrug-cache`, { recursive: true })
  const robotsResponse = await fetch("https://sundrug-online.com/robots.txt", { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "AapriceCatalog" } })
  if (!robotsResponse.ok) throw Error(`robots.txt returned HTTP ${robotsResponse.status}`)
  const robots = await robotsResponse.text()
  await writeFile(`${out}/sundrug-robots.txt`, robots)
  async function fetchCached(url) {
    if (!robotsAllow(robots, url)) throw Error(`robots.txt disallows ${url}`)
    const file = `${out}/sundrug-cache/${createHash("sha256").update(url).digest("hex")}.txt`
    try { return await readFile(file, "utf8") } catch (error) { if (error.code !== "ENOENT") throw error }
    if (cachedOnly) throw Object.assign(Error("Not cached"), { uncached: true })
    if (blocked) throw Error("Skipped after source rate limit")
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "AapriceCatalog" } })
        if (!response.ok) {
          if (response.status === 404) throw Object.assign(new Error("HTTP 404"), { permanent: true })
          if (response.status === 429) blocked = true
          throw Object.assign(new Error(`HTTP ${response.status}`), { retryAfter: Number(response.headers.get("retry-after")) || 0, permanent: response.status === 429 })
        }
        const value = await response.text()
        await writeFile(file, value)
        await new Promise((resolve) => setTimeout(resolve, 350))
        return value
      } catch (error) {
        if (attempt >= 3 || error.permanent) throw error
        await new Promise((resolve) => setTimeout(resolve, Math.max((attempt + 1) * 2000, (error.retryAfter || 0) * 1000)))
      }
    }
  }
  const snapshot = databaseProcess(process.env.AAPRICE_DB_URL, "\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(barcode),'[]'::json) from public.products;")
  const existing = new Set(JSON.parse(snapshot.slice(snapshot.indexOf("["))))
  const maps = sitemapLocations(await fetchCached("https://sundrug-online.com/sitemap.xml")).filter((url) => /^https:\/\/sundrug-online\.com\/sitemap_products_\d+\.xml\?/.test(url))
  if (!maps.length) throw Error("No product sitemaps found")
  const urls = new Set(), failures = [], rows = new Map()
  let completedMaps = 0, completedProducts = 0, fetchedSingleProducts = 0
  await parallel(maps, async (url) => {
    try {
      for (const productUrl of sitemapLocations(await fetchCached(url))) if (/^https:\/\/sundrug-online\.com\/products\/[^/?#]+$/.test(productUrl)) urls.add(productUrl)
    } catch (error) { failures.push({ url, error: error.message }) }
    if (++completedMaps % 25 === 0) console.log(`Sundrug sitemaps ${completedMaps}/${maps.length}`)
  })
  const resolved = new Set()
  let bulkPages = 0
  await parallel(Array.from({ length: 100 }, (_, index) => index + 1), async (page) => {
    const url = `https://sundrug-online.com/products.json?limit=250&page=${page}`
    try {
      const payload = JSON.parse(await fetchCached(url))
      if (!Array.isArray(payload.products)) throw Error("Invalid catalog payload")
      for (const product of payload.products) {
        const productUrl = `https://sundrug-online.com/products/${encodeURIComponent(product.handle)}`
        resolved.add(productUrl)
        for (const row of catalogRows(product, productUrl)) if (!existing.has(row.barcode)) rows.set(row.barcode, row)
      }
    } catch (error) { if (error.message === "HTTP 429") blocked = true; failures.push({ url, error: error.message }) }
    if (++bulkPages % 20 === 0) console.log(`Sundrug bulk pages ${bulkPages}/100; new ${rows.size}`)
  }, 2)
  const pending = [...urls].filter((url) => !resolved.has(url) && !existing.has(decodeURIComponent(new URL(url).pathname.split("/").at(-1))))
  console.log(`Sundrug ${urls.size} product URLs; ${pending.length} unknown handles`)
  await parallel(pending, async (url) => {
    try {
      const payload = JSON.parse(await fetchCached(`${url}.json`))
      if (!payload.product?.title || !Array.isArray(payload.product.variants)) throw Error("Invalid product payload")
      fetchedSingleProducts++
      for (const row of catalogRows(payload.product, url)) if (!existing.has(row.barcode)) rows.set(row.barcode, row)
    } catch (error) { if (error.message === "HTTP 429") blocked = true; failures.push({ url, error: error.message }) }
    if (++completedProducts % 100 === 0 && !cachedOnly) console.log(`Sundrug products ${completedProducts}/${pending.length}; new ${rows.size}`)
  })
  const report = { generatedAt: new Date().toISOString(), cachedOnly, blocked, complete: failures.length === 0, sitemapCount: maps.length, completedMaps, productUrls: urls.size, bulkPages, bulkProducts: resolved.size, pendingUrls: pending.length, processedProductUrls: completedProducts, fetchedSingleProducts, newProducts: rows.size, failures }
  await writeFile(`${out}/sundrug.json`, JSON.stringify([...rows.values()], null, 2))
  await writeFile(`${out}/sundrug-pending-urls.json`, JSON.stringify(failures.map((failure) => failure.url), null, 2))
  await writeFile(`${out}/sundrug-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, failures: failures.length }))
  if (failures.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
