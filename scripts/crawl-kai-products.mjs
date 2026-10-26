import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { validGtin } from "./import-new-products.mjs"

const origin = "https://store.kai-group.com"
const decode = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
const plain = s => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
const locations = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => decode(m[1]))
const productUrl = url => new URL(url).origin === origin && /^\/shop\/g\/g[\w-]+\/$/.test(new URL(url).pathname)

export function parseKaiList(html) {
  const start = html.indexOf("block-goods-list--pager-top"), end = html.indexOf("block-goods-list--pager-bottom")
  if (start < 0 || end <= start) throw Error("Missing current catalog scope")
  const scope = html.slice(start, end)
  const total = Number(scope.match(/pager-count"><span>([\d,]+)<\/span>/)?.[1]?.replaceAll(",", ""))
  const urls = [...new Set([...scope.matchAll(/href="(\/shop\/g\/g[^/]+\/)"/g)].map(m => new URL(m[1], origin).href))]
  if (!Number.isSafeInteger(total) || total < urls.length || (total && !urls.length)) throw Error("Invalid list count")
  return { total, urls }
}

export function parseKaiProduct(html, sourceUrl) {
  if (!productUrl(sourceUrl)) throw Error("Unexpected product URL")
  const labelled = plain(html.match(/<dl class="block-goods-comment5">\s*<dd>([\s\S]*?)<\/dd>/)?.[1] || "")
  if (!validGtin(labelled)) return null
  const data = JSON.parse(html.match(/<script type="application\/json" id="revico-productmaster-data-origin">([\s\S]*?)<\/script>/)?.[1] || "null")
  const detail = JSON.parse(decode(html.match(/<meta property="etm:goods_detail" content="([^"]+)"/)?.[1] || "null"))
  const p = data?.productDataList?.find(p => p.productPageUrl === sourceUrl)
  const canonical = decode(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || "")
  const title = plain(html.match(/<h1 class="[^"]*block-goods-name--text[^"]*">([\s\S]*?)<\/h1>/)?.[1] || "")
  if (/^【名入れ対応】|\/\s*ギフト包装付き/.test(title)) return null
  // Variant pages canonically link to their family leader; the explicit current JAN remains authoritative.
  const canonicalMatches = canonical === sourceUrl || (p?.variationGroup && canonical.startsWith(`${origin}/`) && productUrl(canonical))
  if (!p || p.jan !== labelled || !title || plain(p.productName) !== title || plain(detail?.name || "") !== title || detail?.goods !== p.productCd || sourceUrl !== `${origin}/shop/g/g${p.productCd}/` || !canonicalMatches || detail.set_fg !== "0") return null
  const image = new URL(p.productImageUrl || "/", origin)
  if (image.origin !== origin || !/^\/img\/(?:goods\/|goods-bulk-upload-2601\/)/.test(image.pathname)) return null
  return { barcode: labelled, name: title, brand: "貝印株式会社", pack: "", category: p.categoryName || "", description: "", imageUrl: image.href, catalogSource: "kai", sourceUrl, evidenceType: "official-labelled-jan-productmaster-current-product" }
}

export function mergeKaiCandidate(rows, conflicts, row) {
  const identity = row.barcode.padStart(14, "0"), previous = rows.get(identity)
  if (previous && previous.name !== row.name) { conflicts.set(identity, [previous]); rows.delete(identity) }
  if (conflicts.has(identity)) conflicts.get(identity).push(row)
  else rows.set(identity, row)
}

async function main() {
  const out = process.argv.find(a => a.startsWith("--out="))?.slice(6) || "artifacts/products-round5-2026-10-25"
  const cache = `${out}/kai-cache`, offline = process.argv.includes("--offline")
  const get = await createFetcher(cache, offline, true)
  const robots = (await get(`${origin}/robots.txt`)).html
  const report = { generatedAt: new Date().toISOString(), origin, categories: [], listPages: 0, detailPages: 0, excluded: [], failures: [], knownSamples: [], complete: false }
  let blocked = false
  async function parallel(items, fn) {
    let next = 0
    await Promise.all([0, 1].map(async () => { while (next < items.length && !blocked) { const item = items[next++]; try { await fn(item) } catch (e) { report.failures.push({ item, reason: e.message }); if (/HTTP (403|429)/.test(e.message)) blocked = true } } }))
  }
  const known = new Map(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(json_build_object('barcode',barcode,'name',name)) from public.products;")).map(p => [p.barcode.padStart(14, "0"), p.name]))
  const sitemap = new Set(), current = new Set(), rows = new Map(), all = new Set(), conflicts = new Map()
  const index = locations((await get(`${origin}/sitemap_index.xml`)).html)
  for (const url of index) {
    if (new URL(url).origin !== origin || !robotsAllow(robots, url) || !url.endsWith(".xml.gz")) throw Error("Unexpected sitemap URL")
    const file = `${cache}/${createHash("sha256").update(url).digest("hex")}.xml`
    let xml
    try { xml = await readFile(file, "utf8") } catch {
      if (offline) throw Error("Missing sitemap cache")
      await new Promise(r => setTimeout(r, 1000))
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!response.ok || new URL(response.url).origin !== origin) throw Error(`HTTP ${response.status}`)
      xml = gunzipSync(new Uint8Array(await response.arrayBuffer())).toString()
      await writeFile(file, xml)
    }
    for (const url of locations(xml)) if (productUrl(url)) sitemap.add(url)
  }
  if (!sitemap.size) throw Error("Empty product sitemap")
  const home = (await get("https://www.kai-group.com/")).html
  const categories = [...new Set([...home.matchAll(/https:\/\/store\.kai-group\.com\/shop\/c\/c\d{2}\//g)].map(m => m[0]))]
  if (categories.length < 5) throw Error("Missing official product categories")
  for (const url of categories) {
    const first = parseKaiList((await get(url)).html), found = new Set(first.urls)
    report.listPages++
    await parallel(Array.from({ length: Math.ceil(first.total / first.urls.length) - 1 }, (_, i) => i + 2), async page => {
      const p = parseKaiList((await get(url.replace(/\/$/, `_p${page}/`))).html)
      if (p.total !== first.total) throw Error("Catalog changed while paging")
      p.urls.forEach(u => found.add(u)); report.listPages++
    })
    found.forEach(u => current.add(u))
    report.categories.push({ url, expected: first.total, observed: found.size, complete: first.total === found.size })
  }
  const urls = [...new Set([...current, ...sitemap])]
  Object.assign(report, { sitemapProducts: sitemap.size, currentListings: current.size, discoveredProducts: urls.length, listComplete: report.categories.every(c => c.complete) })
  async function save() {
    report.candidates = rows.size; report.validGtins = all.size
    report.identityConflicts = [...conflicts.values()]
    await writeFile(`${out}/kai.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/kai-report.json`, JSON.stringify(report, null, 2))
  }
  await save()
  await parallel(urls, async url => {
    const row = parseKaiProduct((await get(url)).html, url); report.detailPages++
    if (!row) report.excluded.push({ url, reason: "Missing consistent labelled JAN/current identity or store bundle" })
    else {
      const identity = row.barcode.padStart(14, "0"); all.add(identity)
      if (!known.has(identity)) mergeKaiCandidate(rows, conflicts, row)
      else if (report.knownSamples.length < 10) report.knownSamples.push({ barcode: row.barcode, officialName: row.name, existingName: known.get(identity) })
    }
    if (report.detailPages % 100 === 0) { await save(); console.log(`Kai ${report.detailPages}/${urls.length}: ${rows.size} new`) }
  })
  report.complete = report.listComplete && report.detailPages === urls.length && !report.failures.length
  await save()
  console.log(JSON.stringify({ ...report, excluded: report.excluded.length, knownSamples: report.knownSamples.length }))
  if (!report.complete) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1 })
