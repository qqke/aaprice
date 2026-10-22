import test from "node:test"
import assert from "node:assert/strict"
import { acceptProducts, selectCollections } from "../scripts/crawl-sundrug-collections.mjs"

test("only enumerates the two verified Sundrug collections", () => {
  const collections = [{ handle: "all", products_count: 107000 }, { handle: "dropship", products_count: 21918 }, { handle: "diy_top", products_count: 7984 }]
  assert.deepEqual(selectCollections(collections).map(item => item.handle), ["dropship", "diy_top"])
  assert.throws(() => selectCollections(collections.slice(0, 2)), /Missing or invalid/)
})

test("collection products skip existing and duplicate JANs while counting products without JAN", () => {
  const product = { handle: "4987176356284", title: "商品", variants: [{ barcode: "4987176356284", price: "100" }] }
  const rows = new Map()
  assert.equal(acceptProducts([product, product, { ...product, handle: "no-jan", variants: [] }], rows, new Set()), 1)
  assert.equal(rows.size, 1)
  assert.equal(rows.get("4987176356284").sourceUrl, "https://sundrug-online.com/products/4987176356284")
  const existing = new Map()
  acceptProducts([product], existing, new Set(["4987176356284"]))
  assert.equal(existing.size, 0)
  assert.throws(() => acceptProducts(null, rows, new Set()), /Invalid collection products/)
})
