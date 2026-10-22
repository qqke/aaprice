import { mkdir, readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { validGtin } from "./import-new-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"

const origin = "https://shop.tsuruha.co.jp"
const decode = s => s.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
const plain = s => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()

export function parseTsuruhaProduct(html, sourceUrl) {
  if (new URL(sourceUrl).origin !== origin || !/^\/\d{8,13}\.html$/.test(new URL(sourceUrl).pathname)) throw Error("Unexpected product URL")
  const barcode = plain(html.match(/商品番号\(JANコード\)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/)?.[1] || "")
  const name = plain(html.match(/<span[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/span>/)?.[1] || "")
  if (!validGtin(barcode) || !name) return null
  return { barcode, name, brand: "", pack: "", category: "", description: "", imageUrl: decode(html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] || ""), catalogSource: "tsuruha", sourceUrl }
}

export function parseTsuruhaSitemap(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].flatMap(([, block]) => {
    const url = decode(block.match(/<loc>([^<]+)<\/loc>/)?.[1] || "")
    return /^https:\/\/shop\.tsuruha\.co\.jp\/\d{8,13}\.html$/.test(url) ? [{ url, name: plain(block.match(/<image:title>([\s\S]*?)<\/image:title>/)?.[1] || "") }] : []
  })
}

export function parseTsuruhaApi(product, expectedSkus) {
  if (!expectedSkus.has(product.sku) || product.url_key !== product.sku) throw Error("API SKU/URL mismatch")
  const barcodes = [...new Set((product.custom_attributesV2?.items || []).filter(a => a.code === "tgmd_jan_code").map(a => a.value))]
  if (barcodes.length !== 1 || !validGtin(barcodes[0]) || typeof product.name !== "string" || !product.name.trim()) return null
  return { barcode: barcodes[0], name: plain(product.name), brand: "", pack: "", category: "", description: "", imageUrl: product.image?.url || "", catalogSource: "tsuruha", sourceUrl: `${origin}/${product.url_key}.html` }
}

async function main() {
  const out = process.argv.find(x => x.startsWith("--out="))?.slice(6) || "artifacts/products-round4-2026-10-22"
  const limitArg = process.argv.find(x => x.startsWith("--limit="))?.slice(8)
  const limit = limitArg === undefined ? Infinity : Number(limitArg)
  if (limitArg !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw Error("--limit must be a positive integer")
  const cache = `${out}/tsuruha-cache`
  await mkdir(cache, { recursive: true })
  const robotsResponse = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(30000) })
  if (!robotsResponse.ok) throw Error(`robots.txt HTTP ${robotsResponse.status}`)
  const robots = await robotsResponse.text()
  const report = { source: origin, sitemapProducts: 0, attempted: 0, existing: 0, invalid: 0, failures: [], batches: [], complete: false }
  let throttled = false
  async function load(url, key, query) {
    if (!robotsAllow(robots, url)) throw Error(`robots.txt disallows ${url}`)
    try { return await readFile(`${cache}/${key}`, "utf8") } catch {}
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000), method: query ? "POST" : "GET", body: query ? JSON.stringify({ query }) : undefined, headers: { "User-Agent": "AAPriceCatalog/1.0", ...(query ? { "Content-Type": "application/json" } : {}) } })
      if (response.status === 429) { throttled = true; await new Promise(resolve => setTimeout(resolve, Math.max(30000, Number(response.headers.get("retry-after") || 0) * 1000))); continue }
      if (!response.ok || new URL(response.url).origin !== origin) throw Error(`HTTP ${response.status} ${response.url}`)
      const html = await response.text()
      await writeFile(`${cache}/${key}`, html)
      return html
    }
    throw Error("HTTP 429 after backoff")
  }
  const existing = JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(barcode) from public.products;"))
  const identities = new Set(existing.map(barcode => barcode.padStart(14, "0")))
  const index = await load(`${origin}/media/sitemap.xml`, "index.xml")
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
  let all = []
  for (let i = 0; i < maps.length; i++) all.push(...parseTsuruhaSitemap(await load(maps[i], `sitemap-1-${i + 1}.xml`)))
  all = [...new Map(all.map(p => [p.url, p])).values()]
  report.sitemapProducts = all.length
  const results = new Map(), seenSkus = new Set(), sitemapSkus = new Set(all.map(p => new URL(p.url).pathname.slice(1, -5)))
  report.apiPages = 0
  report.apiRows = 0
  report.missingSkus = []
  report.invalidSkus = []
  const queryFor = page => `{products(search:"",pageSize:500,currentPage:${page},sort:{name:ASC}){total_count page_info{total_pages} items{sku name url_key image{url} custom_attributesV2(filters:{is_searchable:true}){items{code ... on AttributeValue{value}}}}}}`
  const fetchPage = async page => { const query = queryFor(page); return JSON.parse(await load(`${origin}/graphql`, `api-${createHash("sha256").update(query).digest("hex")}.json`, query)) }
  const root = await fetchPage(1)
  if (root.errors?.length || !root.data?.products) throw Error(JSON.stringify(root.errors || root))
  report.apiRootCount = root.data.products.total_count
  const totalPages = root.data.products.page_info.total_pages
  const batches = Array.from({ length: Math.min(totalPages, Math.ceil(limit / 500)) }, (_, i) => i + 1)
  let cursor = 0
  async function checkpoint() { await writeFile(`${out}/tsuruha.json`, JSON.stringify([...results.values()], null, 2)); await writeFile(`${out}/tsuruha-report.json`, JSON.stringify({ ...report, candidates: results.size, remaining: report.apiRootCount - seenSkus.size }, null, 2)) }
  await Promise.all([0, 1].map(async worker => {
    while (cursor < batches.length) {
      if (throttled && worker !== 0) break
      const index = cursor++, page = batches[index]
      try {
        const data = await fetchPage(page)
        if (data.errors?.length) throw Error(JSON.stringify(data.errors))
        const products = data.data.products
        if (products.total_count !== report.apiRootCount || products.page_info.total_pages !== totalPages || products.items.length !== Math.min(500, report.apiRootCount - (page - 1) * 500)) throw Error("API batch pagination mismatch")
        const expected = new Set(products.items.map(p => p.sku).filter(sku => /^\d{8,13}$/.test(sku)))
        for (const product of products.items) {
          if (seenSkus.has(product.sku)) throw Error("Duplicate API SKU")
          seenSkus.add(product.sku)
          let parsed
          try { parsed = parseTsuruhaApi(product, expected) } catch (error) { report.invalid++; report.invalidSkus.push({ sku: product.sku, reason: error.message }); continue }
          if (!parsed) { report.invalid++; report.invalidSkus.push({ sku: product.sku, reason: "Missing/invalid labelled JAN or name" }) }
          else if (identities.has(parsed.barcode.padStart(14, "0"))) report.existing++
          else results.set(parsed.barcode.padStart(14, "0"), parsed)
        }
        report.attempted += products.items.length
        report.apiRows += products.items.length
        report.apiPages++
      } catch (error) { report.failures.push({ batch: index, reason: error.message }); if (/429|403/.test(error.message)) { cursor = batches.length; break } }
      report.batches.push({ attempted: report.attempted, candidates: results.size })
      await checkpoint(); console.log(`Tsuruha ${report.attempted}/${report.apiRootCount}: ${results.size} new`)
    }
  }))
  report.missingSkus = [...sitemapSkus].filter(sku => !seenSkus.has(sku))
  report.apiOnlySkus = [...seenSkus].filter(sku => !sitemapSkus.has(sku))
  report.observedUniqueSkus = seenSkus.size
  report.fetchedAll = seenSkus.size === report.apiRootCount && !report.failures.length
  report.complete = report.fetchedAll && !report.missingSkus.length && !report.invalidSkus.length
  await checkpoint()
  if (!report.complete) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1 })
