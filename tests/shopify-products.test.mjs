import assert from "node:assert/strict"
import test from "node:test"
import { normalizeCatalog } from "../scripts/crawl-shopify-products.mjs"

test("other existing shop catalogs reuse JAN parsing without requiring prices", () => {
  const product = { handle: "商品", title: "テスト", variants: [{ barcode: "4901301234568", title: "Default Title" }] }
  const [row] = normalizeCatalog([product], "sugi", "https://sugi-drug.com")
  assert.equal(row.barcode, "4901301234568")
  assert.equal(row.catalogSource, "sugi")
  assert.equal(row.sourceUrl, "https://sugi-drug.com/products/%E5%95%86%E5%93%81")
  assert.throws(() => normalizeCatalog([product], "sugi", "https://evil.invalid"), /Unexpected/)
})
