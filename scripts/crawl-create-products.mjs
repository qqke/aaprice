import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { validGtin } from "./import-new-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"

const origin = "https://netshop.create-sd.co.jp"
const decode = s => s.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
const plain = s => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
const storeBundle = name => /《セット(?:販売)?》|【セット販売】/.test(name)
const imageMatchesCode = (image, code) => image.split("/").pop().match(/^(\d+)\.(?:jpe?g|png|gif)$/i)?.[1] === code

export function parseCreateList(html) {
  const total = Number(html.match(/navipage_sum_"><strong>([\d,]+)<\/strong>/)?.[1]?.replaceAll(",", ""))
  const scope = html.split('<div class="goods_ goods_list_">')[1]?.split('<div class="navipage_ bottom_">')[0] || ""
  const cards = scope.split('<div class="StyleD_Item_">').slice(1)
  const products = [], excluded = []
  for (const card of cards) {
    const link = card.match(/class="goods_name_" href="(\/shop\/g\/g([^/"?]+)\/)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) throw Error("Missing Create product card identity")
    const barcode = link[2], sourceUrl = new URL(link[1], origin).href, name = plain(link[3])
    const image = decode(card.match(/<img[^>]*src="(\/img\/goods\/S\/[^"?]+)"/)?.[1] || "")
    const cart = decode(card.match(/cart\.aspx\?goods=([^&"]+)/)?.[1] || "")
    if (!validGtin(barcode) || (barcode.length >= 12 && /^(?:02|04|2)/.test(barcode.padStart(14, "0").slice(1))) || /^0{5}/.test(barcode) || storeBundle(name) || !name || (cart && cart !== barcode) || !imageMatchesCode(image, barcode)) {
      excluded.push({ sourceUrl, barcode, reason: "No consistent global product/image/cart identity or store bundle" }); continue
    }
    products.push({ barcode, name, sourceUrl, imageUrl: new URL(image, origin).href,
      brand: plain(card.match(/<div class="maker_">([\s\S]*?)<\/div>/)?.[1] || ""),
      pack: plain(card.match(/<div class="name2_">([\s\S]*?)<\/div>/)?.[1] || ""), category: "", description: "", catalogSource: "create" })
  }
  return { total, products, excluded, cards: cards.length }
}

export function verifyCreateProduct(html, expected) {
  const code = plain(html.match(/商品コード\s*:\s*<\/p>\s*<p class="txt_">([\s\S]*?)<\/p>/)?.[1] || "")
  const name = plain(html.match(/商品名\s*:\s*<\/p>\s*<p class="txt_">([\s\S]*?)<\/p>/)?.[1] || "")
  const hidden = html.match(/<input type="hidden" value="([^"]+)" id="hidden_goods">/)?.[1]
  const canonical = decode(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || "")
  const image = html.match(/<a href="(\/img\/goods\/L\/[^"?]+)" class="img_"/)?.[1] || ""
  return code === expected.barcode && hidden === code && canonical === expected.sourceUrl && name === expected.name && !storeBundle(name) && imageMatchesCode(image, code)
}

export function parseCreateCategory(html) {
  const breadcrumb = html.match(/<ul id="bread-crumb-list">([\s\S]*?)<\/ul>/)?.[1] || ""
  return [...breadcrumb.matchAll(/<span itemprop="title">([\s\S]*?)<\/span>/g)].map(m => plain(m[1])).filter(Boolean).join(" / ")
}

async function main() {
  const out = process.argv.find(a => a.startsWith("--out="))?.slice(6) || "artifacts/products-round5-2026-10-25"
  const cache = `${out}/create-cache`
  await mkdir(cache, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), origin, categories: [], failures: [], excluded: [], listPages: 0, detailPages: 0, complete: false }
  const policy = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(30000) })
  if (!policy.ok && policy.status !== 404) throw Error(`robots HTTP ${policy.status}`)
  const robots = policy.status === 404 ? "" : await policy.text()
  let nextRequest = 0, blocked = false
  async function load(url) {
    if (!robotsAllow(robots, url)) throw Error(`robots disallows ${url}`)
    const file = `${cache}/${createHash("sha256").update(url).digest("hex")}.html`
    try { return await readFile(file, "utf8") } catch {}
    if (process.argv.includes("--offline")) throw Error(`Missing offline cache: ${url}`)
    if (blocked) throw Error("Stopped after rate limit")
    const wait = Math.max(0, nextRequest - Date.now())
    nextRequest = Math.max(nextRequest, Date.now()) + 500
    await new Promise(resolve => setTimeout(resolve, wait))
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "AAPriceCatalog/1.0" } })
    if (response.status === 403) blocked = true
    if (response.status === 429) { blocked = true; await new Promise(resolve => setTimeout(resolve, 30000)) }
    if (!response.ok || new URL(response.url).origin !== origin) throw Error(`HTTP ${response.status}: ${url}`)
    const html = new TextDecoder("shift_jis").decode(await response.arrayBuffer())
    await writeFile(file, html)
    return html
  }
  async function parallel(items, fn) {
    let cursor = 0
    await Promise.all([0, 1].map(async () => { while (cursor < items.length && !blocked) { const item = items[cursor++]; try { await fn(item) } catch (error) { report.failures.push({ item, reason: error.message }) } } }))
  }
  const knownRows = JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(json_build_object('barcode',barcode,'name',name)),'[]'::json) from public.products;"))
  const known = new Map(knownRows.map(p => [p.barcode.padStart(14, "0"), p.name]))
  const home = await load(`${origin}/shop/`)
  const categories = [...new Set([...home.matchAll(/href="\/shop\/c\/c(\d{2})\/"/g)].map(m => m[1]))]
  if (categories.length < 8) throw Error("Incomplete top-level category discovery")
  const all = new Map(), urls = new Set(), products = [], samples = []
  async function save() {
    report.uniqueListings = urls.size; report.uniqueGtins = all.size; report.candidates = products.length
    await writeFile(`${out}/create.json`, JSON.stringify(products, null, 2))
    await writeFile(`${out}/create-report.json`, JSON.stringify(report, null, 2))
    await writeFile(`${out}/create-known-sample.json`, JSON.stringify(samples, null, 2))
  }
  const search = (category, page) => `${origin}/shop/goods/search.aspx?search=x&tree=${category}&ps=24&p=${page}`
  for (const category of categories) {
    if (blocked) break
    const first = parseCreateList(await load(search(category, 1)))
    if (!Number.isSafeInteger(first.total) || first.total < 0 || first.cards !== Math.min(24, first.total)) throw Error(`Invalid category first page ${category}`)
    const cat = { category, expected: first.total, observed: 0, pages: 0, unique: 0 }, found = new Set()
    report.categories.push(cat)
    function add(parsed) {
      parsed.products.forEach(p => { found.add(p.sourceUrl); urls.add(p.sourceUrl); all.set(p.barcode.padStart(14, "0"), p)
        if (samples.length < 20 && known.has(p.barcode.padStart(14, "0"))) samples.push({ barcode: p.barcode, sourceName: p.name, databaseName: known.get(p.barcode.padStart(14, "0")) }) })
      parsed.excluded.forEach(p => { found.add(p.sourceUrl); urls.add(p.sourceUrl) }); report.excluded.push(...parsed.excluded)
      cat.observed += parsed.cards; cat.pages++; cat.unique = found.size; report.listPages++
    }
    add(first)
    await parallel(Array.from({ length: Math.ceil(first.total / 24) - 1 }, (_, i) => i + 2), async page => {
      const parsed = parseCreateList(await load(search(category, page)))
      if (parsed.total !== first.total || parsed.cards !== Math.min(24, first.total - (page - 1) * 24)) throw Error(`Category/page count mismatch ${category}/${page}`)
      add(parsed)
    })
    cat.complete = found.size === first.total && cat.observed === first.total
    console.log(`Create ${category}: ${cat.unique}/${cat.expected}`)
    await save()
  }
  const pending = [...all.values()].filter(p => !known.has(p.barcode.padStart(14, "0")))
  report.pendingDetails = pending.length
  await save()
  await parallel(pending, async p => {
    const html = await load(p.sourceUrl); report.detailPages++
    if (!verifyCreateProduct(html, p)) report.excluded.push({ sourceUrl: p.sourceUrl, reason: "Detail code/name/canonical/image mismatch" })
    else products.push({ ...p, category: parseCreateCategory(html), imageUrl: new URL(html.match(/<a href="(\/img\/goods\/L\/[^"?]+)" class="img_"/)[1], origin).href, evidenceType: "official-labelled-product-code-hidden-code-image" })
    if (report.detailPages % 100 === 0) { console.log(`Create details ${report.detailPages}/${pending.length}: ${products.length} candidates`); await save() }
  })
  report.complete = report.categories.length === categories.length && report.categories.every(c => c.complete) && report.detailPages === pending.length && !report.failures.length
  report.blocked = blocked
  await save()
  if (!report.complete) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
