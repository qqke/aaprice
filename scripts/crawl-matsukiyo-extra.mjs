import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createFetcher } from "./crawl-national-stores.mjs"
import { parseCatalogPage, normalizeProduct } from "./crawl-matsukiyo-products.mjs"
import { validGtin } from "./import-new-products.mjs"
import { databaseProcess } from "./sync-sundrug.mjs"

const endpoint = "https://www.matsukiyococokara-online.com/store/catalog/category/view/categories/"

export function splitPriceRange([low, high]) {
  if (!Number.isSafeInteger(low) || low < 0 || high !== null && (!Number.isSafeInteger(high) || high <= low)) throw Error("Unsplittable price range")
  const middle = high === null ? Math.max(1000, low * 2) : Math.floor((low + high) / 2)
  return [[low, middle], [middle + 1, high]]
}

export async function fetchPricePartitions(get, observed, rows, existing, expectedTotal) {
  const coverage = [], failures = [], priceObserved = new Set(), tasks = [{ range: [0, null], number: 1 }]
  let halted = false, pages = 0
  while (tasks.length && !halted) {
    await Promise.all(tasks.splice(0, 4).map(async task => {
      const { range, number } = task, url = new URL(endpoint)
      url.searchParams.set("price_fromto", `${range[0]}:${range[1] ?? "*"}`)
      url.searchParams.set("page", number)
      try {
        const result = parseCatalogPage((await get(url.href)).html)
        pages++
        if (task.parent) {
          task.parent.childTotals.push(result.total)
          if (task.parent.childTotals.length === 2 && task.parent.childTotals.reduce((a, b) => a + b, 0) !== task.parent.total) throw Error("Price split count mismatch")
        }
        if (number === 1 && range[0] === 0 && range[1] === null && result.total !== expectedTotal) throw Error("Price root count differs from catalog")
        if (!task.group && result.total > 3000) {
          const parent = { total: result.total, childTotals: [] }
          tasks.push(...splitPriceRange(range).map(child => ({ range: child, number: 1, parent })))
          return
        }
        let group = task.group
        if (!group) {
          group = { priceFrom: range[0], priceTo: range[1], expectedProducts: result.total, observed: new Set(), signatures: new Set() }
          coverage.push(group)
          for (let n = 2; n <= Math.ceil(result.total / 60); n++) tasks.push({ range, number: n, group })
        }
        const signature = result.products.map(product => product.sku).join(",")
        if (result.products.length && group.signatures.has(signature)) throw Error("Duplicate price partition page")
        group.signatures.add(signature)
        for (const product of result.products) {
          const row = normalizeProduct(product)
          if (!row || !validGtin(row.barcode)) { failures.push({ url: url.href, barcode: product.sku, reason: "Invalid product/JAN" }); continue }
          group.observed.add(row.barcode)
          priceObserved.add(row.barcode)
          observed.add(row.barcode)
          if (!existing.has(row.barcode)) rows.set(row.barcode, row)
        }
        if (pages % 20 === 0) console.log(`Matsukiyo price partitions: ${pages} pages, ${rows.size} new products, ${tasks.length} queued`)
      } catch (error) {
        failures.push({ url: url.href, reason: error.message })
        if (/429|count mismatch|root count/.test(error.message)) halted = true
      }
    }))
  }
  return { pages, observedProducts: priceObserved.size, expectedLeafTotal: coverage.reduce((sum, group) => sum + group.expectedProducts, 0), failures, halted, pendingRequests: tasks.length, coverage: coverage.map(({ observed: seen, signatures, ...group }) => ({ ...group, observedProducts: seen.size, difference: group.expectedProducts - seen.size })) }
}

export async function fetchExtra(get, baseline, existing) {
  const rows = new Map(), observed = new Set(baseline), coverage = [], failures = []
  const root = parseCatalogPage((await get(endpoint)).html)
  // Both filters are public links on the catalog page; root paging stops when its window repeats.
  const groups = [{ name: "root", query: "" }, { name: "original_brand", query: "original_brand=1" }]
  await Promise.all(groups.map(async group => {
    const progress = { name: group.name, pages: 0, observedProducts: 0, expectedProducts: null, repeatedPage: null }
    coverage.push(progress)
    const seen = new Set(), signatures = new Set()
    for (let page = 1; page <= 100; page++) {
      const url = new URL(endpoint)
      if (group.query) url.search = group.query
      url.searchParams.set("page", page)
      try {
        const result = parseCatalogPage((await get(url.href)).html)
        progress.expectedProducts ??= result.total
        const signature = result.products.map(product => product.sku).join(",")
        if (signatures.has(signature)) { progress.repeatedPage = page; break }
        signatures.add(signature)
        progress.pages++
        for (const product of result.products) {
          const row = normalizeProduct(product)
          if (!row || !validGtin(row.barcode)) { failures.push({ url: url.href, barcode: product.sku, reason: "Invalid product/JAN" }); continue }
          observed.add(row.barcode)
          seen.add(row.barcode)
          if (!existing.has(row.barcode)) rows.set(row.barcode, row)
        }
        progress.observedProducts = seen.size
        if (page % 10 === 0) console.log(`Matsukiyo extra ${group.name}: ${page} pages, ${rows.size} new products`)
        if (page * 60 >= result.total || result.products.length === 0) break
      } catch (error) {
        failures.push({ url: url.href, reason: error.message })
        break
      }
    }
  }))
  const prices = observed.size === root.total ? null : await fetchPricePartitions(get, observed, rows, existing, root.total)
  if (prices) failures.push(...prices.failures)
  const currentObserved = prices ? prices.observedProducts : observed.size
  return { products: [...rows.values()], report: { generatedAt: new Date().toISOString(), expectedProducts: root.total,
    baselineProducts: baseline.size, combinedObservedProducts: observed.size, remainingDifference: root.total - currentObserved,
    newProducts: rows.size, coverage, pricePartitions: prices, failures, complete: currentObserved === root.total && !failures.length && (!prices || prices.expectedLeafTotal === root.total && !prices.halted && !prices.pendingRequests && prices.coverage.every(group => group.difference === 0)) } }
}

async function main() {
  const out = "artifacts/products-round2-2026-10-22"
  const get = await createFetcher(`${out}/matsukiyo-cache`, process.argv.includes("--offline"), process.argv.includes("--resume"))
  const baseline = new Set(JSON.parse(await readFile("artifacts/products-2026-10-22/matsukiyo.json", "utf8")).map(product => product.barcode))
  const snapshot = databaseProcess(process.env.AAPRICE_DB_URL, "\\set QUIET 1\n\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(barcode) from public.products;")
  const { products, report } = await fetchExtra(get, baseline, new Set(JSON.parse(snapshot)))
  await writeFile(`${out}/matsukiyo.json`, JSON.stringify(products, null, 2))
  await writeFile(`${out}/matsukiyo-report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  if (!report.complete) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
