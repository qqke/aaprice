import test from "node:test"
import assert from "node:assert/strict"
import { normalizePublicProduct } from "../scripts/crawl-sundrug-unresolved.mjs"

test("public detail uses actual variant barcode without stripping bundle suffix", () => {
  const p = { title: "Set", handle: "4987241167227s", description: "<p>Detail</p>", images: ["//cdn.shopify.com/a.jpg"], variants: [{ barcode: "4987241167227s", sku: "4987241167227s" }] }
  assert.deepEqual(normalizePublicProduct(p, "https://sundrug-online.com/products/4987241167227s"), [])
  p.variants[0].barcode = "705928001206"
  const [row] = normalizePublicProduct(p, "https://sundrug-online.com/products/4987241167227s")
  assert.equal(row.barcode, "705928001206")
  assert.equal(row.imageUrl, `https:${p.images[0]}`)
  assert.throws(() => normalizePublicProduct(p, "https://sundrug-online.com/products/other"), /Invalid/)
})

