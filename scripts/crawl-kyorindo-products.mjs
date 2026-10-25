import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"
import { pathToFileURL } from "node:url"
import { validGtin } from "./import-new-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"

const origin = "https://www.kyorindo-onlineshop.jp"
const decode = s => s.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
const plain = s => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
const productUrl = url => new URL(url).origin === origin && /^\/shop\/g\/g[^/]+\/$/.test(new URL(url).pathname)
const locations = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1]))
// GS1 020–029, 040–049 and 200–299 identify restricted circulation, not global products.
const globalCode = code => validGtin(code) && !/^(?:02|04|2)/.test(code.padStart(14, "0").slice(1)) && !/^0{5}/.test(code)

export function parseKyorindoList(html) {
  const start = html.indexOf("block-goods-list--pager-top"), end = html.indexOf("block-goods-list--pager-bottom")
  if (start < 0 || end <= start) throw Error("Missing current catalog list")
  html = html.slice(start, end)
  const total = Number(html.match(/pager-count"><span>([\d,]+)<\/span>/)?.[1]?.replaceAll(",", ""))
  const urls = [...html.matchAll(/<dl class="block-thumbnail-t--goods[^>]*>([\s\S]*?)<\/dl>/g)].map(([, card]) => {
    const url = new URL(card.match(/href="(\/shop\/g\/g[^/]+\/)"/)?.[1] || "/", origin).href
    if (!productUrl(url)) throw Error("Invalid catalog product URL")
    return url
  })
  if (!Number.isSafeInteger(total) || total < urls.length) throw Error("Invalid catalog count")
  return { total, urls }
}

export function parseKyorindoProduct(html, sourceUrl) {
  if (!productUrl(sourceUrl)) throw Error("Unexpected product origin/path")
  const code = plain(html.match(/<dd id="spec_goods">([\s\S]*?)<\/dd>/)?.[1] || "")
  if (!globalCode(code) || !sourceUrl.endsWith(`/g${code}/`)) return null
  for (const [, text] of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let p
    try { p = JSON.parse(text) } catch { continue }
    if (p?.["@type"] !== "Product" || p.mpn !== code || typeof p.name !== "string" || !p.name.trim() || typeof p.image !== "string") continue
    if (/《セット(?:販売)?》|【セット(?:販売|品)】/.test(p.name)) return null
    const image = new URL(p.image, origin)
    if (image.origin !== origin || !new RegExp(`^${code}(?:[^0-9]|$)`).test(image.pathname.split("/").pop())) return null
    return { barcode: code, name: plain(p.name), imageUrl: image.href, brand: "", pack: "", category: "", description: "", catalogSource: "kyorindo", sourceUrl, evidenceType: "official-detail-product-code-mpn-image" }
  }
  return null
}

async function main() {
  const out = process.argv.find(a => a.startsWith("--out="))?.slice(6) || "artifacts/products-round5-2026-10-25"
  const cache = `${out}/kyorindo-cache`
  await mkdir(cache, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), source: origin, listPages: 0, detailPages: 0, failures: [], excluded: [], complete: false, completenessScope: "All current catalog pages enumerated and every database-unknown URL inspected; excluded non-global codes, bundles and insufficient evidence remain excluded." }
  const robotsResponse = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(30000) })
  if (!robotsResponse.ok && robotsResponse.status !== 404) throw Error(`robots HTTP ${robotsResponse.status}`)
  const robots = robotsResponse.status === 404 ? "" : await robotsResponse.text()
  let nextRequest = 0, blocked = false
  async function load(url) {
    if (new URL(url).origin !== origin || !robotsAllow(robots, url)) throw Error("Unexpected or disallowed source URL")
    const file = `${cache}/${createHash("sha256").update(url).digest("hex")}.txt`
    try { return await readFile(file, "utf8") } catch {}
    if (blocked) throw Error("Stopped after source refusal")
    const delay = Math.max(0, nextRequest - Date.now()); nextRequest = Math.max(nextRequest, Date.now()) + 500
    await new Promise(r => setTimeout(r, delay))
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if ([403, 429].includes(response.status)) {
      blocked = true
      if (response.status === 429) await new Promise(r => setTimeout(r, 30000))
    }
    if (!response.ok || new URL(response.url).origin !== origin) throw Error(`HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = url.endsWith(".gz") ? gunzipSync(bytes).toString() : new TextDecoder().decode(bytes)
    await writeFile(file, text)
    return text
  }
  async function parallel(items, fn) {
    let next = 0
    await Promise.all([0, 1].map(async () => { while (next < items.length && !blocked) { const item = items[next++]; try { await fn(item) } catch (e) { report.failures.push({ item, reason: e.message }) } } }))
  }
  const known = new Map(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(json_build_object('barcode',barcode,'name',name)) from public.products;")).map(p => [p.barcode.padStart(14, "0"), p.name]))
  const maps = locations(await load(`${origin}/Sitemap_index.xml`)), sitemap = new Set(), current = new Set(), rows = new Map()
  await parallel(maps, async url => { for (const loc of locations(await load(url))) if (productUrl(loc)) sitemap.add(loc) })
  if (!sitemap.size) throw Error("No sitemap products")
  const first = parseKyorindoList(await load(`${origin}/shop/c/c0/`))
  if (!first.urls.length) throw Error("Empty catalog list")
  first.urls.forEach(u => current.add(u)); report.listPages++
  report.listExpected = first.total; report.sitemapProducts = sitemap.size
  await parallel(Array.from({ length: Math.ceil(first.total / first.urls.length) - 1 }, (_, i) => i + 2), async page => {
    const p = parseKyorindoList(await load(`${origin}/shop/c/c0_p${page}/`))
    if (p.total !== first.total || !p.urls.length) throw Error("Catalog count changed or empty page")
    p.urls.forEach(u => current.add(u)); report.listPages++
  })
  report.currentUniqueListings = current.size
  report.currentListComplete = current.size === first.total
  report.listOutsideSitemap = [...current].filter(u => !sitemap.has(u))
  const urls = [...new Set([...sitemap, ...current])]
  report.discoveredProducts = urls.length
  const codeOf = url => url.match(/\/g([^/]+)\/$/)[1]
  const pending = urls.filter(u => !known.has(codeOf(u).padStart(14, "0")))
  report.pendingDetails = pending.length
  async function save() {
    report.candidates = rows.size
    await writeFile(`${out}/kyorindo.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/kyorindo-report.json`, JSON.stringify(report, null, 2))
  }
  await save()
  await parallel(pending, async url => {
    const row = parseKyorindoProduct(await load(url), url); report.detailPages++
    if (!row) report.excluded.push({ url, reason: "No consistent global product code, mpn and main image, or store bundle" })
    else if (!known.has(row.barcode.padStart(14, "0"))) rows.set(row.barcode.padStart(14, "0"), row)
    if (report.detailPages % 25 === 0) { await save(); console.log(`Kyorindo details ${report.detailPages}/${pending.length}: ${rows.size} candidates`) }
  })
  report.knownSamples = []
  await parallel(urls.filter(u => globalCode(codeOf(u)) && known.has(codeOf(u).padStart(14, "0"))).slice(0, 10), async url => {
    const row = parseKyorindoProduct(await load(url), url)
    if (!row) throw Error(`Known product validation failed ${url}`)
    report.knownSamples.push({ barcode: row.barcode, sourceName: row.name, existingName: known.get(row.barcode.padStart(14, "0")) })
  })
  report.complete = !blocked && !report.failures.length && report.currentListComplete && report.detailPages === pending.length
  await save()
  console.log(JSON.stringify({ ...report, excluded: report.excluded.length, knownSamples: report.knownSamples.length }, null, 2))
  if (!report.complete) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1 })
