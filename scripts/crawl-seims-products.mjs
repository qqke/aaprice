import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { robotsAllow } from "./crawl-drugstores.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { validGtin } from "./import-new-products.mjs"

const origin = "https://www.seims.co.jp"
const plain = s => String(s || "").replace(/<[^>]*>/g, " ").replaceAll("&amp;", "&").replaceAll("&nbsp;", " ").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code))).replace(/\s+/g, " ").trim()
const identity = code => code.padStart(14, "0")
const restricted = code => /^(?:02|04|2)/.test(identity(code).slice(1)) || /^0{5}[02]\d{7}$/.test(identity(code).slice(1))
const matchesImage = (url, barcode, size) => url.origin === origin && new RegExp(`^/img/goods/${size}/${barcode}(?:_[A-Za-z0-9_-]+)?\\.jpg$`).test(url.pathname)

export function parseSeimsList(html, sourceUrl) {
  if (new URL(sourceUrl).origin !== origin || !/^\/shop\/c\/c\d+(?:_p\d+)?\/$/.test(new URL(sourceUrl).pathname)) throw Error("Unexpected category URL")
  const total = Number(html.match(/pager-count[^>]*>\s*<span>([\d,]+)<\/span>/)?.[1]?.replaceAll(",", ""))
  if (!Number.isFinite(total)) throw Error("Missing category total")
  const rows = [], excluded = [], cardUrls = new Set()
  const blocks = [...html.matchAll(/<li class="block-pickup-list-p--item\b[^>]*>([\s\S]*?)<\/li>/g)]
  for (const [, block] of blocks) {
    const link = block.match(/class="block-pickup-list-p--goods-name"[^>]*>\s*<a href="([^"]+)">([\s\S]*?)<\/a>/)
    const url = new URL(link?.[1] || "/", origin), barcode = url.pathname.match(/^\/shop\/g\/g(\d+)\/$/)?.[1], name = plain(link?.[2])
    if (link?.[1] && url.origin === origin && /^\/shop\/g\/g[^/]+\/$/.test(url.pathname)) cardUrls.add(url.href)
    const img = block.match(/<img[^>]+src="([^"]+)"[^>]+alt="([^"]*)"/)
    const image = new URL(img?.[1] || "/", origin)
    if (!barcode || !validGtin(barcode) || restricted(barcode) || /^0{5}/.test(barcode)) { excluded.push({ url: url.href, reason: "Invalid global GTIN" }); continue }
    if (url.origin !== origin || !matchesImage(image, barcode, "S") || !name || plain(img?.[2]) !== name) { excluded.push({ url: url.href, reason: "List name, product URL and main image do not agree" }); continue }
    if (/まとめ買い|セット販売|【セット品】|[0-9０-９]+(?:個|本|袋|箱|点|パック)\s*セット/.test(name)) { excluded.push({ url: url.href, reason: "Potential store bundle" }); continue }
    rows.push({ barcode, name, imageUrl: image.href, description: plain(block.match(/class="block-pickup-list-p--comment"[^>]*>([\s\S]*?)<\/div>/)?.[1]), category: plain(block.match(/data-category="([^"]+)"/)?.[1]).replace(/\(\d+\)$/, ""), brand: plain(block.match(/data-brand="([^"]*)"/)?.[1]), pack: "", catalogSource: "seims", sourceUrl: url.href, catalogUrl: sourceUrl, evidenceType: "official-product-list-url-image-name" })
  }
  if (total && !blocks.length) throw Error("Empty product list despite positive total")
  const nextPath = html.match(/<link rel="next" href="([^"]+)"/)?.[1]
  return { rows, excluded, total, count: blocks.length, cardUrls: [...cardUrls], next: nextPath ? new URL(nextPath, origin).href : null }
}

export function recordSeimsCoverage(previous, page, seen) {
  const coverage = previous || { total: page.total, pages: 0, observed: 0, unique: 0, totalChanged: false, complete: false }
  for (const url of page.cardUrls) seen.add(url)
  coverage.pages++; coverage.observed += page.count; coverage.unique = seen.size
  coverage.totalChanged ||= page.total !== coverage.total
  coverage.complete = !coverage.totalChanged && coverage.unique === coverage.total
  return coverage
}

export function verifySeimsDetail(html, row) {
  const decode = value => String(value || "").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&#39;", "'")
  const metadata = JSON.parse(decode(html.match(/<meta property="metatag:goods_detail" content="([^"]+)"/)?.[1]))
  const canonical = decode(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1])
  const imageUrl = decode(html.match(/<meta property="og:image" content="([^"]+)"/)?.[1])
  const displayedCode = plain(html.match(/<dd id="spec_goods">([^<]+)<\/dd>/)?.[1])
  if (!validGtin(row.barcode) || restricted(row.barcode) || metadata.goods !== row.barcode || displayedCode !== row.barcode || canonical !== row.sourceUrl || !matchesImage(new URL(imageUrl, origin), row.barcode, "L") || plain(metadata.name) !== row.name || metadata.set_fg !== "0") throw Error("Current detail code, name, canonical, main image or single-item status disagrees")
  return { ...row, imageUrl, evidenceType: "official-current-detail-code-canonical-image-name", verifiedAt: new Date().toISOString() }
}

export async function readSeimsResponse(url, fetcher, beforeAttempt) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await beforeAttempt()
    try {
      const response = await fetcher(url, { headers: { "User-Agent": "AAPriceCatalog/1.0" }, signal: AbortSignal.timeout(30000) })
      if (new URL(response.url).origin !== origin) throw Error(`Redirected outside official origin: ${url}`)
      if (!response.ok) throw Object.assign(Error(`HTTP ${response.status} ${url}`), { status: response.status })
      return await response.text()
    } catch (error) {
      if (attempt === 2 || error.message.startsWith("Redirected") || (error.status && error.status < 500)) throw error
    }
  }
}

export function summarizeSeimsCompletion(report, finishedAt = new Date().toISOString()) {
  const paginationComplete = report.remainingPages.length === 0 && !report.failures.some(f => /\/shop\/c\//.test(f.url))
  const countsStable = Object.values(report.categories).every(category => !category.totalChanged)
  const processingFinished = paginationComplete && report.detailsComplete
  return { paginationComplete, countsStable, processingFinished, finishedAt: processingFinished ? finishedAt : null }
}

async function main() {
  const out = process.argv.find(x => x.startsWith("--out="))?.slice(6) || "artifacts/products-round5-2026-10-25"
  const cache = `${out}/seims-cache`; await mkdir(cache, { recursive: true })
  let robots
  let lastRequest = Date.now()
  async function get(url) {
    if (new URL(url).origin !== origin || (url !== `${origin}/robots.txt` && (!robots || !robotsAllow(robots, url)))) throw Error(`Disallowed URL ${url}`)
    const file = `${cache}/${createHash("sha256").update(url).digest("hex")}.json`
    try { return JSON.parse(await readFile(file, "utf8")).html } catch {}
    if (process.argv.includes("--offline")) throw Error(`Missing cached ${url}`)
    const html = await readSeimsResponse(url, fetch, async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 10200 - (Date.now() - lastRequest))))
      lastRequest = Date.now()
    })
    await writeFile(file, JSON.stringify({ url, collectedAt: new Date().toISOString(), html })); return html
  }
  try { robots = await readFile(`${out}/seims-robots.txt`, "utf8") } catch { robots = await get(`${origin}/robots.txt`); await writeFile(`${out}/seims-robots.txt`, robots) }
  const queryPrefix = "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\n"
  const known = new Set(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, `${queryPrefix}select coalesce(json_agg(barcode),'[]') from public.products;`)).map(identity))
  let home
  try { home = await readFile(`${out}/seims-home.html`, "utf8") } catch { home = await get(`${origin}/`); await writeFile(`${out}/seims-home.html`, home) }
  const queue = [...new Set([...home.matchAll(/\/shop\/c\/c\d{2}\//g)].map(m => origin + m[0]))]
  if (!queue.length) throw Error("No top-level categories discovered")
  const maxPages = Number(process.argv.find(x => x.startsWith("--max-pages="))?.slice(12) || Infinity)
  const maxDetails = Number(process.argv.find(x => x.startsWith("--max-details="))?.slice(14) || Infinity)
  const rows = new Map(), verified = new Map(), all = new Set(), visited = new Set(), categorySeen = new Map()
  const report = { generatedAt: new Date().toISOString(), source: origin, requestIntervalMs: 10200, categories: {}, pages: 0, validGtins: 0, existing: 0, listCandidates: 0, candidates: 0, detailsAttempted: 0, detailsRemaining: 0, knownSamples: [], excluded: [], detailExcluded: [], failures: [], remainingPages: [], listComplete: false, detailsComplete: false, complete: false }
  async function save() { report.listCandidates = rows.size; report.candidates = verified.size; report.validGtins = all.size; report.detailsRemaining = rows.size - report.detailsAttempted; report.remainingPages = queue.filter(x => !visited.has(x)); await writeFile(`${out}/seims-list-candidates.json`, JSON.stringify([...rows.values()], null, 2)); await writeFile(`${out}/seims.json`, JSON.stringify([...verified.values()], null, 2)); await writeFile(`${out}/seims-report.json`, JSON.stringify(report, null, 2)) }
  await save()
  while (queue.length && report.pages < maxPages) {
    const url = queue.shift(); if (visited.has(url)) continue
    try {
      const result = parseSeimsList(await get(url), url); visited.add(url); report.pages++
      const category = new URL(url).pathname.match(/c(\d+)/)[1]
      if (!categorySeen.has(category)) categorySeen.set(category, new Set())
      report.categories[category] = recordSeimsCoverage(report.categories[category], result, categorySeen.get(category))
      report.excluded.push(...result.excluded)
      for (const row of result.rows) { const id = identity(row.barcode); if (all.has(id)) continue; all.add(id); if (known.has(id)) { report.existing++; if (report.knownSamples.length < 30) report.knownSamples.push({ barcode: row.barcode, officialName: row.name }) } else rows.set(id, row) }
      if (result.next && !visited.has(result.next)) queue.push(result.next)
      await save(); console.log(`Seims ${report.pages} pages; ${rows.size} new; ${report.existing} known; ${queue.length} category continuations`)
    } catch (error) { report.failures.push({ url, reason: error.message }); queue.unshift(url); break }
  }
  report.listComplete = queue.length === 0 && !report.failures.length && Object.values(report.categories).every(c => c.complete)
  if (!report.failures.length) for (const row of rows.values()) {
    if (report.detailsAttempted >= maxDetails) break
    try { const html = await get(row.sourceUrl); try { verified.set(identity(row.barcode), verifySeimsDetail(html, row)) } catch (error) { report.detailExcluded.push({ url: row.sourceUrl, reason: error.message }) } }
    catch (error) { report.failures.push({ url: row.sourceUrl, reason: error.message }); break }
    report.detailsAttempted++; await save(); console.log(`Seims details ${report.detailsAttempted}/${rows.size}: ${verified.size} verified`)
  }
  report.detailsComplete = report.detailsAttempted === rows.size && !report.failures.length
  if (report.knownSamples.length) {
    const codes = report.knownSamples.map(p => `'${identity(p.barcode)}'`).join(",")
    const samples = JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, `${queryPrefix}select json_agg(json_build_object('barcode',barcode,'name',name)) from public.products where lpad(barcode,14,'0') in (${codes});`))
    const names = new Map(samples.map(p => [identity(p.barcode), p.name]))
    report.knownSamples.forEach(p => { p.existingName = names.get(identity(p.barcode)) })
  }
  report.complete = report.listComplete && report.detailsComplete
  Object.assign(report, summarizeSeimsCompletion(report))
  await save(); if (!report.complete) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
