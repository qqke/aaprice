import { mkdir, readFile, writeFile, readdir } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { parseKirindoList, parseKirindoProduct } from "./crawl-kirindo-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { validGtin } from "./import-new-products.mjs"

const origin = "https://www.kirindo-shop.com"
export const categories = ["kensyoku", "kusuri", "cosme", "bc", "ey", "nz", "babykaigo", "pet", "foodsdrink", "ks"]

export function parseCategoryList(html) {
  const start = html.search(/<div class="fs-c-productList">/)
  if (start < 0) throw Error("Missing main product list")
  const parsed = parseKirindoList(html.slice(start))
  if (!Number.isSafeInteger(parsed.total) || parsed.total < 0 || parsed.products.length > parsed.total) throw Error("Invalid category count")
  return parsed
}

async function main() {
  const out = "artifacts/products-round3-2026-10-22", cache = `${out}/kirindo-categories-cache`
  await mkdir(cache, { recursive: true })
  const get = await createFetcher(cache, process.argv.includes("--offline"), true)
  const oldCache = `${out}/kirindo-cache`, rootListings = new Set(), listings = new Map(), rows = new Map()
  for (const file of await readdir(oldCache)) if (/^list-\d+\.html$/.test(file)) {
    for (const p of parseKirindoList(await readFile(`${oldCache}/${file}`, "utf8")).products) rootListings.add(p.url)
  }
  const existing = new Set(JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(barcode),'[]'::json) from public.products;")).map(v => v.padStart(14, "0")))
  const report = { generatedAt: new Date().toISOString(), rootListings: rootListings.size, categories: [], failures: [], excluded: [], detailPages: 0, candidates: 0, complete: false }
  report.rootTotal = JSON.parse(await readFile(`${out}/kirindo-report.json`, "utf8")).expected
  let blocked = false
  async function load(url, category, page) {
    if (blocked) throw Error("Stopped after rate limit")
    if (category === "kusuri" && page === 1) {
      try { return await readFile(`${out}/kirindo-category-kusuri.html`, "utf8") } catch {}
    }
    try { return (await get(url)).html }
    catch (error) { if (/429/.test(error.message)) { blocked = true; await new Promise(r => setTimeout(r, 30000)) }; throw error }
  }
  async function save() {
    report.candidates = rows.size
    await writeFile(`${out}/kirindo-categories.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/kirindo-categories-report.json`, JSON.stringify(report, null, 2))
  }
  for (const category of categories) {
    if (blocked) break
    const progress = { category, expected: null, pages: 0, unique: 0, complete: false }, found = new Map()
    report.categories.push(progress)
    try {
      const first = parseCategoryList(await load(`${origin}/c/${category}`, category, 1))
      progress.expected = first.total
      first.products.forEach(p => found.set(p.url, p)); progress.pages++
      if (first.total && !first.products.length) throw Error("Empty first category page")
      for (let page = 2; page <= Math.ceil(first.total / first.products.length); page++) {
        const parsed = parseCategoryList(await load(`${origin}/c/${category}?page=${page}&sort=priority`, category, page))
        if (parsed.total !== first.total || !parsed.products.length) throw Error("Category count changed or empty page")
        const before = found.size
        parsed.products.forEach(p => found.set(p.url, p)); progress.pages++
        if (found.size === before) throw Error("Repeated category page")
      }
      if (found.size !== first.total) throw Error(`Category coverage ${found.size}/${first.total}`)
      progress.complete = true
    } catch (error) { report.failures.push({ category, reason: error.message }) }
    progress.unique = found.size
    found.forEach((p, url) => listings.set(url, p))
    console.log(`Kirindo category ${category}: ${progress.unique}/${progress.expected}, complete=${progress.complete}`)
    await save()
  }
  const pending = [...listings.values()].filter(p => !rootListings.has(p.url) && (!validGtin(p.url.split("/").at(-1)) || !existing.has(p.url.split("/").at(-1).padStart(14, "0"))))
  report.uniqueListings = listings.size; report.pendingDetails = pending.length
  report.combinedUniqueListings = new Set([...rootListings, ...listings.keys()]).size
  report.globalComplete = report.combinedUniqueListings === report.rootTotal
  let cursor = 0
  await Promise.all([0, 1].map(async () => { while (cursor < pending.length && !blocked) {
    const p = pending[cursor++]
    try {
      let html
      try { html = await readFile(`${oldCache}/${Buffer.from(p.url).toString("base64url")}.html`, "utf8") }
      catch { html = await load(p.url) }
      const row = parseKirindoProduct(html, p.url)
      report.detailPages++
      if (!row) report.excluded.push({ url: p.url, reason: "No explicit valid gtin13" })
      else if (!existing.has(row.barcode.padStart(14, "0"))) rows.set(row.barcode.padStart(14, "0"), row)
    } catch (error) { report.failures.push({ url: p.url, reason: error.message }) }
    if (report.detailPages % 25 === 0) { console.log(`Kirindo category details ${report.detailPages}/${pending.length}, candidates ${rows.size}`); await save() }
  } }))
  report.complete = report.categories.length === categories.length && report.categories.every(c => c.complete) && report.detailPages === pending.length && !report.failures.length
  report.blocked = blocked
  await save()
  console.log(JSON.stringify({ uniqueListings: listings.size, pendingDetails: pending.length, detailPages: report.detailPages, candidates: rows.size, failures: report.failures.length, complete: report.complete }))
  if (!report.complete) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
