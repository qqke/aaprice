import test from "node:test"
import assert from "node:assert/strict"
import { fetchExtra, splitPriceRange, fetchPricePartitions } from "../scripts/crawl-matsukiyo-extra.mjs"

const html = (ids, total) => `<input name="searched_products" value="${JSON.stringify(ids.map(sku => ({ sku, product_name: `商品 ${sku}` }))).replaceAll('"', '&quot;')}"><script>var totalSize = ${total};</script>`

test("extra catalog merges root and original brand without rewriting existing products", async () => {
  const existing = "4901301452085", root = "4901301452078", brand = "4901301234568"
  const result = await fetchExtra(async url => ({ html: html(new URL(url).searchParams.has("original_brand") ? [brand] : [existing, root], 3) }), new Set([existing]), new Set([existing]))
  assert.deepEqual(new Set(result.products.map(row => row.barcode)), new Set([root, brand]))
  assert.equal(result.report.remainingDifference, 0)
  assert.equal(result.report.complete, true)
})

test("repeated paging windows stop and preserve incomplete coverage", async () => {
  let calls = 0
  const result = await fetchExtra(async url => { calls++; return { html: html(["4901301452085"], new URL(url).searchParams.has("price_fromto") ? 1 : 6001) } }, new Set(), new Set())
  assert.equal(calls, 6)
  assert.equal(result.report.complete, false)
  assert.ok(result.report.coverage.every(group => group.repeatedPage === 2))
})

test("price partitions include zero and have adjacent closed boundaries with an open upper tail", () => {
  assert.deepEqual(splitPriceRange([0, 1000]), [[0, 500], [501, 1000]])
  assert.deepEqual(splitPriceRange([0, null]), [[0, 1000], [1001, null]])
  assert.deepEqual(splitPriceRange([1001, null]), [[1001, 2002], [2003, null]])
  assert.throws(() => splitPriceRange([0, 0]), /Unsplittable/)
})

test("price partitions enumerate pages, preserve existing products and stop ignored filters", async () => {
  const barcode = "4901301452085", rows = new Map(), observed = new Set()
  const result = await fetchPricePartitions(async () => ({ html: html([barcode], 1) }), observed, rows, new Set([barcode]), 1)
  assert.equal(result.coverage[0].priceFrom, 0)
  assert.equal(result.coverage[0].priceTo, null)
  assert.equal(result.coverage[0].difference, 0)
  assert.equal(result.observedProducts, 1)
  assert.equal(result.expectedLeafTotal, 1)
  assert.equal(rows.size, 0)
  assert.equal(observed.size, 1)
  const bad = await fetchPricePartitions(async () => ({ html: html([barcode], 1) }), new Set(), new Map(), new Set(), 6001)
  assert.equal(bad.halted, true)
})
