import { mkdir, readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { validGtin } from "./import-new-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"

const origin = "https://www.kirindo-shop.com"
const decode = value => value.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")

export function parseKirindoList(html) {
  const products = [...html.matchAll(/<h2 class="fs-c-productListItem__productName[^>]*>([\s\S]*?)<\/h2>/g)].map(([, card]) => ({
    url: new URL(decode(card.match(/href="([^"]+)"/)?.[1] || "/"), origin).href,
    name: decode(card.match(/fs-c-productName__name">([^<]*)/)?.[1] || ""),
  })).filter(product => { const url = new URL(product.url); return url.origin === origin && url.pathname.startsWith("/c/") })
  return { total: Number(html.match(/fs-c-listControl__status__total">(\d+)/)?.[1]), products }
}

export function parseKirindoProduct(html, sourceUrl) {
  for (const [, content] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let product
    try { product = JSON.parse(content) } catch { continue }
    if (product["@type"] !== "Product" || !validGtin(product.gtin13) || typeof product.name !== "string" || !product.name.trim()) continue
    if (new URL(product.url).origin !== origin || product.url !== sourceUrl) throw Error("Product URL mismatch")
    return { barcode: product.gtin13, name: decode(product.name), imageUrl: decode(typeof product.image === "string" ? product.image : ""), description: decode(product.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), brand: "", pack: "", category: "", catalogSource: "kirindo", sourceUrl }
  }
  return null
}

async function main() {
  const out = process.argv.find(a => a.startsWith("--out="))?.slice(6) || "artifacts/products-round3-2026-10-22"
  const cache = `${out}/kirindo-cache`
  await mkdir(cache, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), source: origin, listPages: 0, detailPages: 0, failures: [], excluded: [], complete: false }
  const robotsResponse = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(30000) })
  if (!robotsResponse.ok && robotsResponse.status !== 404) throw Error(`robots.txt HTTP ${robotsResponse.status}`)
  const robots = robotsResponse.status === 404 ? "" : await robotsResponse.text()
  report.robotsStatus = robotsResponse.status
  let nextRequest = 0
  async function load(url, key) {
    if (!robotsAllow(robots, url)) throw Error(`robots.txt disallows ${url}`)
    const file = `${cache}/${key}.html`
    try { return await readFile(file, "utf8") } catch {}
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = Math.max(0, nextRequest - Date.now())
      nextRequest = Math.max(nextRequest, Date.now()) + 500
      await new Promise(r => setTimeout(r, delay))
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (response.status === 429) { await new Promise(r => setTimeout(r, 10000 * (attempt + 1))); continue }
      if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`)
      const html = await response.text()
      await writeFile(file, html)
      return html
    }
    throw Error(`Rate limited: ${url}`)
  }
  async function parallel(items, fn) {
    let cursor = 0
    await Promise.all([0, 1].map(async () => { while (cursor < items.length) { const item = items[cursor++]; try { await fn(item) } catch (error) { report.failures.push({ item, error: error.message }) } } }))
  }
  const first = parseKirindoList(await load(`${origin}/p/search?page=1&sort=latest`, "list-1"))
  if (!first.total || !first.products.length) throw Error("Missing catalog count/products")
  const listings = new Map(first.products.map(p => [p.url, p]))
  report.expected = first.total
  report.listPages++
  await parallel(Array.from({ length: Math.ceil(first.total / first.products.length) - 1 }, (_, i) => i + 2), async page => {
    const parsed = parseKirindoList(await load(`${origin}/p/search?page=${page}&sort=latest`, `list-${page}`))
    if (parsed.total !== first.total || !parsed.products.length) throw Error("Catalog count changed or empty page")
    parsed.products.forEach(p => listings.set(p.url, p))
    report.listPages++
  })
  report.uniqueListings = listings.size
  const existing = new Set(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(barcode),'[]'::json) from public.products;" )).map(v => v.padStart(14, "0")))
  const pending = [...listings.values()].filter(p => { const id = p.url.split("/").pop(); return !validGtin(id) || !existing.has(id.padStart(14, "0")) })
  report.pendingDetails = pending.length
  console.log(`Kirindo listings ${listings.size}/${first.total}; unknown detail candidates ${pending.length}`)
  const products = new Map()
  async function save() {
    report.candidates = products.size
    await writeFile(`${out}/kirindo.json`, JSON.stringify([...products.values()], null, 2))
    await writeFile(`${out}/kirindo-report.json`, JSON.stringify(report, null, 2))
  }
  await save()
  await parallel(pending, async p => {
    const key = Buffer.from(p.url).toString("base64url")
    const product = parseKirindoProduct(await load(p.url, key), p.url)
    report.detailPages++
    if (!product) { report.excluded.push({ url: p.url, reason: "No explicit valid gtin13 in Product JSON-LD" }); return }
    if (!existing.has(product.barcode.padStart(14, "0"))) products.set(product.barcode.padStart(14, "0"), product)
    if (report.detailPages % 50 === 0) { await save(); console.log(`Kirindo details ${report.detailPages}/${pending.length}, candidates ${products.size}`) }
  })
  report.candidates = products.size
  report.complete = listings.size === first.total && report.failures.length === 0
  await save()
  console.log(JSON.stringify(report, null, 2))
  if (!report.complete) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1 })
