import { mkdir, readFile, writeFile } from "node:fs/promises"
import { gunzipSync } from "node:zlib"
import { pathToFileURL } from "node:url"
import { validGtin } from "./import-new-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"

const origin = "https://tomods-ap.com"
const decode = s => s.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
const plain = s => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()

export function parseTomodsList(html) {
  const start = html.indexOf("block-goods-list--pager-top"), end = html.indexOf("block-goods-list--pager-bottom")
  if (start >= 0 && end > start) html = html.slice(start, end)
  const products = [], excluded = []
  for (const [, card] of html.matchAll(/<dl class="block-goods-detail-[^"]*--goods js-enhanced-ecommerce-item">([\s\S]*?)<\/dl>/g)) {
    const path = card.match(/href="(\/shop\/g\/g([^/"?]+)\/)"/)
    if (!path) throw Error("Missing product card link")
    const barcode = path[2], sourceUrl = new URL(path[1], origin).href
    const name = plain(card.match(/class="js-enhanced-ecommerce-goods-name">([\s\S]*?)<\/a>/)?.[1] || "")
    const image = decode(card.match(/data-src="([^"]+)"/)?.[1] || "")
    const cartCode = decode(card.match(/cart\.aspx\?goods=([^&"]+)/)?.[1] || "")
    if (!validGtin(barcode) || /^0{5}/.test(barcode) || (cartCode && cartCode !== barcode) || !new RegExp(`^${barcode}(?:[^0-9]|$)`).test(new URL(image || "/", origin).pathname.split("/").pop()) || !name) {
      excluded.push({ sourceUrl, barcode, reason: "Invalid product/image code or conflicting cart code" }); continue
    }
    products.push({ barcode, sourceUrl, name, imageUrl: new URL(image, origin).href, brand: decode(card.match(/data-brand="([^"]*)"/)?.[1] || ""), category: decode(card.match(/data-category="([^"]*)"/)?.[1] || "").replace(/\(\d+\)$/, ""), pack: "", description: "", catalogSource: "tomods", evidenceType: cartCode ? "official-catalog-cart-image-code" : "official-catalog-image-code" })
  }
  return { products, excluded, total: Number(html.match(/pager-count"><span>([\d,]+)<\/span>/)?.[1]?.replaceAll(",", "")) }
}

export function verifyTomodsProduct(html, expected) {
  const code = plain(html.match(/<dd id="spec_goods">([\s\S]*?)<\/dd>/)?.[1] || "")
  const objects = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap(([, s]) => { try { return [JSON.parse(s)] } catch { return [] } })
  const p = objects.find(p => p["@type"] === "Product")
  return code === expected.barcode && p?.mpn === code && plain(p.name || "") === expected.name && new RegExp(`^${code}(?:[^0-9]|$)`).test(new URL(p.image || "/", origin).pathname.split("/").pop())
}

async function main() {
  const out = process.argv.find(a => a.startsWith("--out="))?.slice(6) || "artifacts/products-round4-2026-10-22"
  const cache = `${out}/tomods-cache`
  await mkdir(cache, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), origin, categories: [], failures: [], excluded: [], listPages: 0, detailPages: 0, complete: false }
  const robotsResponse = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(30000) })
  if (!robotsResponse.ok && robotsResponse.status !== 404) throw Error(`robots HTTP ${robotsResponse.status}`)
  const robots = robotsResponse.status === 404 ? "" : await robotsResponse.text()
  let nextRequest = 0
  async function load(url, key) {
    if (!robotsAllow(robots, url)) throw Error(`robots disallows ${url}`)
    const file = `${cache}/${key}`
    try { return await readFile(file, "utf8") } catch {}
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(0, nextRequest - Date.now())
      nextRequest = Math.max(nextRequest, Date.now()) + 500
      await new Promise(r => setTimeout(r, wait))
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (response.status === 429) { await new Promise(r => setTimeout(r, 10000 * (attempt + 1))); continue }
      if (!response.ok) throw Error(`HTTP ${response.status} ${url}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const text = url.endsWith(".gz") ? gunzipSync(bytes).toString() : new TextDecoder().decode(bytes)
      await writeFile(file, text)
      return text
    }
    throw Error(`Rate limited ${url}`)
  }
  async function parallel(items, fn) {
    let cursor = 0
    await Promise.all([0, 1].map(async () => { while (cursor < items.length) { const item = items[cursor++]; try { await fn(item) } catch (e) { report.failures.push({ item, error: e.message }) } } }))
  }
  const known = new Set(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(barcode),'[]'::json) from public.products;")).map(v => v.padStart(14, "0")))
  const home = await load(origin, "home.html")
  const categories = [...new Set([...home.matchAll(/href="(\/shop\/c\/c\d{2}\/)"/g)].map(m => m[1]))]
  const listings = new Map(), allUrls = new Set()
  function add(parsed) {
    parsed.products.forEach(p => { allUrls.add(p.sourceUrl); listings.set(p.barcode.padStart(14, "0"), p) })
    parsed.excluded.forEach(p => allUrls.add(p.sourceUrl))
    report.excluded.push(...parsed.excluded)
    report.listPages++
  }
  for (const path of categories) {
    const key = path.split("/").filter(Boolean).pop()
    const first = parseTomodsList(await load(`${origin}${path}?ps=100`, `${key}-1.html`))
    if (!Number.isInteger(first.total) || first.total < 0) throw Error(`Missing category total ${path}`)
    const cat = { path, expected: first.total, observed: first.products.length + first.excluded.length, pages: 1 }
    report.categories.push(cat)
    add(first)
    await parallel(Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, i) => i + 2), async page => {
      const parsed = parseTomodsList(await load(`${origin}${path.replace(/\/$/, `_p${page}/`)}?ps=100`, `${key}-${page}.html`))
      const count = parsed.products.length + parsed.excluded.length
      if (parsed.total !== first.total || !count || count > Math.min(100, first.total - (page - 1) * 100)) throw Error(`Category page size mismatch ${path} ${page}`)
      add(parsed); cat.pages++; cat.observed += count
    })
    console.log(`Tomods ${path} ${cat.observed}/${cat.expected}`)
  }
  const index = await load(`${origin}/Sitemap_index.xml`, "sitemap-index.xml")
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1]))
  const sitemapUrls = new Set()
  await parallel(maps, async url => {
    if (new URL(url).origin !== origin) throw Error("Unexpected sitemap origin")
    const xml = await load(url, url.split("/").pop() + ".xml")
    for (const [, loc] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) if (/\/shop\/g\/g[^/]+\/$/.test(loc)) sitemapUrls.add(decode(loc))
  })
  report.uniqueListings = allUrls.size
  report.uniqueGtins = listings.size
  report.sitemapProducts = sitemapUrls.size
  report.sitemapOutsideList = [...sitemapUrls].filter(url => !allUrls.has(url))
  const pending = [...listings.values()].filter(p => !known.has(p.barcode.padStart(14, "0")))
  report.pendingDetails = pending.length
  const products = []
  async function save() {
    report.candidates = products.length
    await writeFile(`${out}/tomods.json`, JSON.stringify(products, null, 2))
    await writeFile(`${out}/tomods-report.json`, JSON.stringify(report, null, 2))
  }
  await save()
  await parallel(pending, async p => {
    const html = await load(p.sourceUrl, `${p.barcode}.html`)
    report.detailPages++
    if (!verifyTomodsProduct(html, p)) { report.excluded.push({ sourceUrl: p.sourceUrl, reason: "Detail product code/mpn/name/image mismatch" }); return }
    products.push({ ...p, evidenceType: "official-product-mpn-code-image" })
    if (report.detailPages % 100 === 0) { await save(); console.log(`Tomods verified ${report.detailPages}/${pending.length}`) }
  })
  report.currentPagesComplete = report.failures.length === 0 && report.categories.every(c => c.pages === Math.ceil(c.expected / 100))
  report.expectedCategorySum = report.categories.reduce((sum, c) => sum + c.expected, 0)
  report.observedCategorySum = report.categories.reduce((sum, c) => sum + c.observed, 0)
  report.sitemapNote = "Index lastmod is 2021-11-01; old sitemap URLs do not describe the current catalog and are not treated as current missing products."
  report.complete = report.currentPagesComplete && report.categories.every(c => c.observed === c.expected)
  await save()
  console.log(JSON.stringify({ ...report, excluded: report.excluded.length, sitemapOutsideList: report.sitemapOutsideList.length }, null, 2))
  if (!report.complete) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1 })
