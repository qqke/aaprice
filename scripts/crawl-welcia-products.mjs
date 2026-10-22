import { mkdir, readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { validGtin } from "./import-new-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"

const origin = "https://www.e-welcia.com"
const decode = s => s.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")

export function parseWelciaList(html) {
  const classes = JSON.parse(html.match(/eccube\.productsClassCategories\s*=\s*([\s\S]*?);/)?.[1] || "{}")
  const products = [], excluded = []
  for (const [, card] of html.matchAll(/<li class="ec-shelfGrid__item">([\s\S]*?)<\/li>/g)) {
    const sourceUrl = decode(card.match(/<a href="([^"]+)"/)?.[1] || "")
    const id = sourceUrl.match(/^https:\/\/www\.e-welcia\.com\/product\/(\d+)$/)?.[1]
    if (!id) throw Error("Unexpected list product URL")
    const image = card.match(/<img src="([^"]+)" alt="([^"]*)"/)
    const codes = new Set()
    function visit(value) {
      if (!value || typeof value !== "object") return
      if (value.product_code) codes.add(value.product_code)
      Object.values(value).forEach(visit)
    }
    visit(classes[id])
    // One card name cannot identify different variants; leave those for detail verification.
    if (codes.size !== 1 || !validGtin([...codes][0]) || !image?.[2]?.trim()) { excluded.push({ sourceUrl, codes: [...codes], reason: "Missing unambiguous valid product_code/name" }); continue }
    products.push({ barcode: [...codes][0], name: decode(image[2]), imageUrl: new URL(decode(image[1]), origin).href, brand: "", pack: "", category: "", description: "", catalogSource: "welcia", sourceUrl })
  }
  return { total: Number(html.match(/ec-font-bold">([\d,]+)件/)?.[1]?.replaceAll(",", "")), products, excluded }
}

async function main() {
  const out = process.argv.find(a => a.startsWith("--out="))?.slice(6) || "artifacts/products-round4-2026-10-22"
  const cache = `${out}/welcia-cache`
  await mkdir(cache, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), origin, listPages: 0, sitemapPages: 0, failures: [], excluded: [], complete: false }
  const response = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok && response.status !== 404) throw Error(`robots HTTP ${response.status}`)
  const robots = response.status === 404 ? "" : await response.text()
  let nextRequest = 0
  async function load(url, key) {
    if (!robotsAllow(robots, url)) throw Error(`robots disallows ${url}`)
    const file = `${cache}/${key}`
    try { return await readFile(file, "utf8") } catch {}
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(0, nextRequest - Date.now())
      nextRequest = Math.max(nextRequest, Date.now()) + 500
      await new Promise(r => setTimeout(r, wait))
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (r.status === 429) { await new Promise(r => setTimeout(r, 10000 * (attempt + 1))); continue }
      if (!r.ok) throw Error(`HTTP ${r.status} ${url}`)
      const text = await r.text()
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
  const first = parseWelciaList(await load(`${origin}/products/list?disp_number=100&pageno=1`, "list-1.html"))
  if (!first.total || first.products.length + first.excluded.length !== 100) throw Error("List count/page size missing")
  report.expected = first.total
  const all = new Map(), listings = new Set()
  function add(parsed) {
    parsed.products.forEach(p => { listings.add(p.sourceUrl); all.set(p.barcode.padStart(14, "0"), p) })
    parsed.excluded.forEach(p => listings.add(p.sourceUrl))
    report.excluded.push(...parsed.excluded)
    report.listPages++
  }
  add(first)
  await parallel(Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, i) => i + 2), async page => {
    const parsed = parseWelciaList(await load(`${origin}/products/list?disp_number=100&pageno=${page}`, `list-${page}.html`))
    if (parsed.total !== first.total || parsed.products.length + parsed.excluded.length !== Math.min(100, first.total - (page - 1) * 100)) throw Error(`Page ${page} count mismatch`)
    add(parsed)
    if (report.listPages % 20 === 0) console.log(`Welcia list pages ${report.listPages}/${Math.ceil(first.total / 100)}`)
  })
  const index = await load(`${origin}/sitemap.xml`, "sitemap.xml.txt")
  const maps = [...index.matchAll(/<loc>(https:\/\/www\.e-welcia\.com\/sitemap_product_\d+\.xml)<\/loc>/g)].map(m => m[1])
  const sitemapUrls = new Set()
  await parallel(maps, async url => {
    const xml = await load(url, `${url.split("/").pop()}.txt`)
    for (const [, loc] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) sitemapUrls.add(decode(loc))
    report.sitemapPages++
  })
  report.uniqueListings = listings.size
  report.uniqueGtins = all.size
  report.sitemapProducts = sitemapUrls.size
  report.sitemapOutsideList = [...sitemapUrls].filter(url => !listings.has(url))
  const candidates = [...all].filter(([key]) => !known.has(key)).map(([, p]) => p)
  report.candidates = candidates.length
  report.complete = listings.size === first.total && report.failures.length === 0 && report.sitemapOutsideList.length === 0
  await writeFile(`${out}/welcia.json`, JSON.stringify(candidates, null, 2))
  await writeFile(`${out}/welcia-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, sitemapOutsideList: report.sitemapOutsideList.length, excluded: report.excluded.length }, null, 2))
  if (!report.complete) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1 })
