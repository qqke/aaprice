import test from "node:test"
import assert from "node:assert/strict"
import { catalogRows, sitemapLocations, validBarcode } from "../scripts/crawl-sundrug-products.mjs"

test("product sitemap locations decode query separators without treating image locations as product URLs", () => {
  assert.deepEqual(sitemapLocations('<loc>https://example.com/?from=1&amp;to=2</loc><image:loc>image</image:loc>'), ["https://example.com/?from=1&to=2"])
})

test("catalog accepts real JAN without price and rejects invalid check digits", () => {
  assert.equal(validBarcode("4987176356284"), true)
  assert.equal(validBarcode("4987176356285"), false)
  assert.equal(validBarcode("12345678901"), false)
  const rows = catalogRows({ title: "商品", vendor: "メーカー", tags: "常温, 日用品", body_html: "<p>商品&nbsp;説明</p>", variants: [{ barcode: "4987176356284", price: null, title: "Default Title" }, { barcode: "4987176356285" }] }, "https://sundrug-online.com/products/4987176356284")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].barcode, "4987176356284")
  assert.equal(rows[0].category, "日用品")
  assert.equal(rows[0].description, "商品 説明")
  assert.equal(rows[0].catalogSource, "sundrug")
  assert.equal(rows[0].pack, "")
  assert.equal("priceYen" in rows[0], false)
})
