import { mkdir, readFile, writeFile, access } from "node:fs/promises"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { validGtin } from "./import-new-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { robotsAllow } from "./crawl-drugstores.mjs"

const origin = "https://www.elpadirect.jp"
const decode = s => s.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
const plain = s => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
const globalCode = s => validGtin(s) && !/^(?:02|04|2)/.test(s.padStart(14, "0").slice(1))

export function parseElpaList(html, listUrl) {
  const total = Number(html.match(/plg_raku2_product_count_fh">([\d,]+)件/)?.[1]?.replaceAll(",", ""))
  const cards = [...html.matchAll(/<form name="product_form(\d+)"[^>]*>([\s\S]*?)<\/form>/g)]
  if (!Number.isSafeInteger(total) || !cards.length || cards.length > total) throw Error("Invalid list count/cards")
  const rows = [], excluded = []
  for (const [, id, card] of cards) {
    try {
      const barcode = plain(card.match(/JANコード:\s*<span class="product_rcatalog_id_default">([^<]*)<\/span>/)?.[1] || "")
      if (!globalCode(barcode)) throw Error("Missing/global-invalid JAN")
      const heading = card.match(/<h3 class="raku2_list_product_name">([\s\S]*?)<\/h3>/)?.[1] || ""
      const name = plain(heading), sourceUrl = decode(heading.match(/href="([^"]+)"/)?.[1] || "")
      if (!name || new URL(sourceUrl).origin !== origin || new URL(sourceUrl).pathname !== `/products/${barcode}/`) throw Error("JAN and product URL/name disagree")
      if (heading.match(/data-product_code="([^"]+)"/)?.[1] !== barcode || plain(heading.match(/data-name="([^"]+)"/)?.[1] || "") !== name) throw Error("Card identity disagreement")
      if (!/エルパ|\bELPA\b/.test(name)) throw Error("Outside existing ELPA brand scope")
      if (/《セット(?:販売)?》|【セット(?:販売|品)】/.test(name)) throw Error("Store bundle")
      const maker = plain(heading.match(/data-maker_name="([^"]+)"/)?.[1] || "")
      if (maker !== "朝日電器株式会社") throw Error("Manufacturer not confirmed")
      const imageUrl = new URL(decode(card.match(/<img[^>]+src="([^"]+)"/)?.[1] || ""), origin)
      if (imageUrl.origin !== origin || !imageUrl.pathname.startsWith("/upload/save_image/") || /noimage|no_image|sorry/i.test(imageUrl.pathname)) throw Error("Missing product image")
      rows.push({ barcode, name, brand: maker, pack: "", category: "", description: "", imageUrl: imageUrl.href, catalogSource: "elpa", sourceUrl, evidenceType: "official-list-explicit-jan", evidenceUrl: listUrl, sourceProductId: id })
    } catch (e) { excluded.push({ id, reason: e.message }) }
  }
  return { total, ids: cards.map(m => m[1]), rows, excluded }
}

export function verifyElpaDetail(html, row) {
  const jan = plain(html.match(/id="product_rcatalog_id_default">([^<]*)<\/span>/)?.[1] || "")
  const title = plain(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").replace(/\s*｜\s*エルパ・ダイレクト$/, "")
  const canonical = decode(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || "")
  return jan === row.barcode && title === row.name && canonical === row.sourceUrl
}

async function main() {
  const out = process.argv.find(a => a.startsWith("--out="))?.slice(6) || "artifacts/products-round5-2026-10-25"
  try { await access(`${out}/elpa.json`); throw Error("Candidate artifact already exists; use a new --out directory to preserve import evidence") } catch (e) { if (e.code !== "ENOENT") throw e }
  await mkdir(`${out}/elpa-cache`, { recursive: true })
  const report = { generatedAt: new Date().toISOString(), source: origin, officialAssociation: "https://www.elpa.co.jp/news/detail/elpadirect2024.html", listPages: 0, failures: [], excluded: [], detailSamples: [], complete: false, completenessScope: "Public full-store list enumeration; candidates limited to clearly identified existing ELPA brand. Exclusions do not imply missing pages." }
  const robotsResponse = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(30000) })
  if (!robotsResponse.ok && robotsResponse.status !== 404) throw Error(`robots HTTP ${robotsResponse.status}`)
  const robots = robotsResponse.status === 404 ? "" : await robotsResponse.text()
  let nextRequest = 0, blocked = false
  async function load(url) {
    if (new URL(url).origin !== origin || !robotsAllow(robots, url)) throw Error("Unexpected/disallowed URL")
    const file = `${out}/elpa-cache/${createHash("sha256").update(url).digest("hex")}.html`
    try { return await readFile(file, "utf8") } catch {}
    if (blocked) throw Error("Stopped after refusal")
    const delay = Math.max(0, nextRequest - Date.now()); nextRequest = Math.max(Date.now(), nextRequest) + 500
    await new Promise(r => setTimeout(r, delay))
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if ([403, 429].includes(response.status)) { blocked = true; if (response.status === 429) await new Promise(r => setTimeout(r, 30000)) }
    if (!response.ok || new URL(response.url).origin !== origin) throw Error(`HTTP ${response.status}`)
    const html = await response.text(); await writeFile(file, html); return html
  }
  async function parallel(items, fn) {
    let index = 0
    await Promise.all([0, 1].map(async () => { while (index < items.length && !blocked) { const item = items[index++]; try { await fn(item) } catch (e) { report.failures.push({ item, reason: e.message }) } } }))
  }
  const known = new Set(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(barcode) from public.products;")).map(s => s.padStart(14, "0")))
  const urlFor = page => `${origin}/products/?category_id=0&disp_number=100&pageno=${page}`
  const first = parseElpaList(await load(urlFor(1)), urlFor(1)), ids = new Set(), rows = new Map()
  report.expectedProducts = first.total; report.pageSize = first.ids.length
  function collect(page) {
    if (page.total !== first.total) throw Error("Catalogue count changed")
    for (const id of page.ids) { if (ids.has(id)) throw Error(`Repeated product ${id}`); ids.add(id) }
    report.excluded.push(...page.excluded)
    for (const row of page.rows) {
      const key = row.barcode.padStart(14, "0"), old = rows.get(key)
      if (old && old.name !== row.name) throw Error(`Conflicting names for JAN ${row.barcode}`)
      rows.set(key, row)
    }
    report.listPages++
  }
  collect(first)
  await parallel(Array.from({ length: Math.ceil(first.total / first.ids.length) - 1 }, (_, i) => i + 2), async page => { collect(parseElpaList(await load(urlFor(page)), urlFor(page))); if (report.listPages % 10 === 0) console.log(`ELPA ${report.listPages} pages, ${ids.size} products, ${rows.size} valid brand rows`) })
  const all = [...rows.values()], pending = all.filter(r => !known.has(r.barcode.padStart(14, "0")))
  const samples = [...pending.slice(0, 5), ...all.filter(r => known.has(r.barcode.padStart(14, "0"))).slice(0, 5)]
  await parallel(samples, async row => {
    const matches = verifyElpaDetail(await load(row.sourceUrl), row)
    report.detailSamples.push({ barcode: row.barcode, sourceUrl: row.sourceUrl, matches })
    if (!matches) throw Error(`Detail mismatch for ${row.barcode}`)
  })
  report.uniqueProducts = ids.size; report.validBrandRows = all.length; report.knownSkipped = all.length - pending.length; report.candidates = pending.length
  report.complete = !blocked && !report.failures.length && ids.size === first.total && report.detailSamples.length === samples.length
  await writeFile(`${out}/elpa.json`, JSON.stringify(pending, null, 2))
  await writeFile(`${out}/elpa-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, excluded: report.excluded.length }, null, 2))
  if (!report.complete) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1 })
