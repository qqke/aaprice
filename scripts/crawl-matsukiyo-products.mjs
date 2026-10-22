import { mkdir, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { robotsAllow } from "./crawl-drugstores.mjs"

const ENDPOINT = "https://www.matsukiyococokara-online.com/store/catalog/category/view/categories/"
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
const decode = (value) => value.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")

export function parseCatalogPage(html) {
  const match = html.match(/name="searched_products"\s+value="([^"]*)"/)
  if (!match) throw new Error("Matsukiyo catalog payload missing")
  const products = JSON.parse(decode(match[1]))
  const total = Number(html.match(/var totalSize\s*=\s*(\d+)/)?.[1])
  if (!Array.isArray(products) || !Number.isSafeInteger(total) || total < 0) throw new Error("Invalid Matsukiyo catalog payload")
  const visible = html.slice(html.indexOf('id="showMcshp0111"'), html.indexOf('name="searched_products"'))
  for (const card of visible.split('data-datalayer=').slice(1)) {
    const encoded = card.match(/^'([^']*)'/)?.[1]
    if (!encoded) continue
    const item = JSON.parse(decode(encoded))
    if (!item.item_id || !item.item_name) continue
    products.push({ sku: item.item_id, product_name: item.item_name, image_uri: decode(card.match(/<img\s+src="([^"]*)"/)?.[1] || "") })
  }
  const tree = html.match(/name="factcategories"\s+value='([^']*)'/)
  return { products: [...new Map(products.map((product) => [product.sku, product])).values()], total, categories: tree ? JSON.parse(decode(tree[1])) : [] }
}

export function normalizeProduct(product) {
  const barcode = text(product.sku)
  const name = text(product.product_name)
  if (!/^(?:\d{8}|\d{12,14})$/.test(barcode) || !name) return null
  return {
    barcode, name, brand: "", pack: "", category: "",
    description: text(product.description).slice(0, 2000),
    imageUrl: /^https:\/\//.test(product.image_uri || "") ? product.image_uri : "",
    catalogSource: "matsukiyo",
    sourceUrl: `https://www.matsukiyococokara-online.com/store/catalog/product/view/id/${barcode}`,
  }
}

export async function fetchCatalog({ existingBarcodes = new Set(), fetchImpl = fetch } = {}) {
  const failures = []
  const robotsResponse = await fetchImpl(new URL("/robots.txt", ENDPOINT).href, { signal: AbortSignal.timeout(30_000) })
  if (!robotsResponse.ok) throw new Error("Matsukiyo robots.txt unavailable")
  const robots = await robotsResponse.text()
  async function page(number, category) {
    const url = new URL(ENDPOINT)
    url.searchParams.set("page", number)
    if (category) url.searchParams.set("categories", JSON.stringify({ [category.id]: category.name }))
    if (!robotsAllow(robots, url.href)) throw new Error(`robots.txt disallows ${url}`)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(45_000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return parseCatalogPage(await response.text())
      } catch (error) {
        if (attempt === 3) { failures.push({ page: number, category: category?.id, error: error.message }); return null }
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
      }
    }
  }
  const first = await page(1)
  if (!first || !first.products.length) throw new Error("Matsukiyo first catalog page unavailable or empty")
  const rows = new Map()
  const coverage = []
  let fetchedProducts = 0
  let fetchedPages = 0
  let rejectedProducts = 0
  function collect(result, number, group) {
    if (!result) return
    const signature = result.products.map((p) => p.sku).join(",")
    if (result.products.length && group.signatures.has(signature)) {
      failures.push({ page: number, category: group.id, error: "Duplicate page payload" }); return
    }
    group.signatures.add(signature)
    fetchedPages++
    fetchedProducts += result.products.length
    for (const product of result.products) {
      const row = normalizeProduct(product)
      if (!row) rejectedProducts++
      else {
        group.barcodes.add(row.barcode)
        if (!existingBarcodes.has(row.barcode)) rows.set(row.barcode, row)
      }
    }
  }
  const tasks = first.categories.length ? first.categories.map((category) => ({ category, number: 1 })) : [{ number: 1, result: first }]
  // shortcut: split searches above 3000 results to stay below the observed public search window.
  while (tasks.length) {
    const batch = tasks.splice(0, 4)
    await Promise.all(batch.map(async ({ category, number, group, result }) => {
      const payload = result || await page(number, category)
      if (!payload) return
      if (!group) {
        if (payload.total > 3000 && category?.sub?.length) {
          tasks.push(...category.sub.map((child) => ({ category: child, number: 1 })))
          return
        }
        group = { id: category?.id || "all", name: category?.name || "all", expectedProducts: payload.total, signatures: new Set(), barcodes: new Set() }
        coverage.push(group)
        const pages = Math.min(50, Math.ceil(payload.total / 60))
        if (payload.total > 3000) failures.push({ category: group.id, error: "Search window exceeds 3000 products without child categories", expectedProducts: payload.total })
        for (let n = 2; n <= pages; n++) tasks.push({ category, number: n, group })
      }
      collect(payload, number, group)
    }))
    if (fetchedPages % 20 < 4) console.log(`Matsukiyo ${fetchedPages} pages, ${rows.size} unique products, ${tasks.length} pending requests`)
  }
  const classCoverage = coverage.map(({ signatures, barcodes, ...group }) => ({ ...group, uniqueProducts: barcodes.size, difference: group.expectedProducts - barcodes.size }))
  return { source: ENDPOINT, fetchedAt: new Date().toISOString(), expectedProducts: first.total, globalDifference: first.total - new Set(coverage.flatMap((group) => [...group.barcodes])).size, fetchedPages, fetchedProducts, rejectedProducts, failures, coverage: classCoverage, products: [...rows.values()] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await fetchCatalog()
  const output = process.argv[2] || "artifacts/products-2026-10-22/matsukiyo.json"
  await mkdir(new URL("../", pathToFileURL(`${process.cwd()}/${output}`)), { recursive: true })
  await writeFile(output, `${JSON.stringify(result.products, null, 2)}\n`)
  const { products, ...report } = result
  await writeFile(output.replace(/\.json$/, "-report.json"), `${JSON.stringify({ ...report, uniqueProducts: products.length }, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, uniqueProducts: products.length }))
  if (result.failures.length || result.globalDifference !== 0 || result.coverage.some((group) => group.difference !== 0)) process.exitCode = 1
}
