import { writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"
import { validGtin } from "./import-new-products.mjs"

const origin = "https://net-shop.doramori.co.jp"
const plain = value => String(value || "").replace(/<[^>]*>/g, " ").replaceAll("&amp;", "&").replaceAll("&nbsp;", " ").replace(/\s+/g, " ").trim()

export function parseDoramoriProduct(html, sourceUrl) {
  const url = new URL(sourceUrl)
  if (url.origin !== origin || !/^\/i\/[^/?#]+$/.test(url.pathname)) throw Error("Unexpected Doramori URL")
  const products = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap(([, text]) => { try { const value = JSON.parse(text); return Array.isArray(value) ? value : [value] } catch { return [] } })
    .filter(value => value?.["@type"] === "Product")
  if (products.length !== 1) throw Error("Missing unambiguous current Product")
  const product = products[0], barcode = product.sku, name = plain(product.name)
  if (!validGtin(barcode) || (barcode.length >= 12 && /^(?:02|04|2)/.test(barcode.padStart(14, "0").slice(1))) || /^0{5}/.test(barcode)) throw Error("Invalid/global identity unavailable")
  if (!name || /セット販売|まとめ買い|【セット品】/.test(name)) throw Error("Missing name or store bundle")
  const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/)?.[1]
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers
  const imageUrl = Array.isArray(product.image) ? product.image[0] : product.image
  const image = new URL(imageUrl || "/", origin)
  if (canonical !== sourceUrl || offer?.url !== sourceUrl || url.pathname !== `/i/${barcode}` || image.origin !== origin || !new RegExp(`^${barcode}(?:[^0-9]|$)`).test(image.pathname.split("/").pop())) throw Error("SKU, canonical, offer URL and main image do not agree")
  return { barcode, name, imageUrl: image.href, description: plain(product.description), brand: "", pack: "", category: "", catalogSource: "doramori", sourceUrl, evidenceType: "official-current-product-sku-canonical-offer-image" }
}

async function main() {
  const out = process.argv.find(arg => arg.startsWith("--out="))?.slice(6) || "artifacts/products-round5-2026-10-25"
  const get = await createFetcher(`${out}/doramori-cache`, process.argv.includes("--offline"), true)
  const existing = JSON.parse(databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(json_build_object('barcode',barcode,'name',name)),'[]') from public.products;"))
  const known = new Map(existing.map(p => [p.barcode.padStart(14, "0"), p]))
  const xml = (await get(`${origin}/sitemap.xml`)).html
  const urls = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replaceAll("&amp;", "&")).filter(url => url.startsWith(`${origin}/i/`)))]
  if (!urls.length) throw Error("No Doramori product sitemap entries")
  const report = { generatedAt: new Date().toISOString(), source: origin, sitemapProducts: urls.length, attempted: 0, validGtins: 0, existing: 0, candidates: 0, excluded: [], failures: [], knownSamples: [], fetchedAll: false, complete: false }
  const rows = new Map(), all = new Set()
  let cursor = 0, stopped = false
  async function save() {
    report.candidates = rows.size; report.validGtins = all.size
    await writeFile(`${out}/doramori.json`, JSON.stringify([...rows.values()], null, 2))
    await writeFile(`${out}/doramori-report.json`, JSON.stringify(report, null, 2))
  }
  await Promise.all([0, 1].map(async () => {
    while (cursor < urls.length && !stopped) {
      const url = urls[cursor++]
      try {
        const html = (await get(url)).html
        try {
          const row = parseDoramoriProduct(html, url), identity = row.barcode.padStart(14, "0")
          all.add(identity)
          if (known.has(identity)) {
            report.existing++
            if (report.knownSamples.length < 20) report.knownSamples.push({ barcode: row.barcode, officialName: row.name, existingName: known.get(identity).name })
          } else rows.set(identity, row)
        } catch (error) { report.excluded.push({ url, reason: error.message }) }
      } catch (error) { report.failures.push({ url, reason: error.message }); if (/403|429/.test(error.message)) stopped = true }
      report.attempted++
      if (report.attempted % 25 === 0) { await save(); console.log(`Doramori ${report.attempted}/${urls.length}: ${rows.size} new`) }
    }
  }))
  report.fetchedAll = report.attempted === urls.length && !report.failures.length
  report.complete = report.fetchedAll && !report.excluded.length
  await save()
  if (!report.fetchedAll) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
