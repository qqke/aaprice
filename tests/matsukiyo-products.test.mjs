import test from "node:test"
import assert from "node:assert/strict"
import { parseCatalogPage, normalizeProduct, fetchCatalog } from "../scripts/crawl-matsukiyo-products.mjs"

const page = (products, total) => `<input name="searched_products" value="${JSON.stringify(products).replaceAll('"', '&quot;')}"><script>var totalSize = ${total};</script>`
test("Matsukiyo parses encoded JSON and preserves official JAN source", () => {
  const product = { sku: "4901301452085", product_name: "商品 & テスト", image_uri: "https://example.com/a.jpg" }
  assert.equal(parseCatalogPage(page([product], 1)).products[0].product_name, product.product_name)
  assert.equal(normalizeProduct(product).sourceUrl.endsWith(product.sku), true)
  assert.equal(normalizeProduct({ ...product, sku: "invalid" }), null)
  assert.throws(() => parseCatalogPage("blocked"), /missing/)
})
test("Matsukiyo enumerates pages and skips existing barcodes", async () => {
  const result = await fetchCatalog({ existingBarcodes: new Set(["4901301452085"]), fetchImpl: async (url) => ({ ok: true, text: async () => url.endsWith("robots.txt") ? "User-agent: *\nAllow: /" : page([{ sku: url.endsWith("=1") ? "4901301452085" : "4901301452078", product_name: "商品" }], 61) }) })
  assert.equal(result.fetchedPages, 2)
  assert.deepEqual(result.products.map((p) => p.barcode), ["4901301452078"])
  assert.deepEqual(result.failures, [])
})
test("Matsukiyo merges visible cards and hidden payload without duplicate JANs", () => {
  const html = `<ul id="showMcshp0111"><div data-datalayer='{&quot;item_id&quot;:&quot;4901301452085&quot;,&quot;item_name&quot;:&quot;表示商品&quot;}'><img src="https://example.com/a.jpg"></div></ul>${page([{ sku: "4901301452085", product_name: "重複商品" }], 1)}`
  const result = parseCatalogPage(html)
  assert.equal(result.products[0].sku, "4901301452085")
  assert.equal(result.products[0].image_uri, "https://example.com/a.jpg")
  assert.equal(result.products.length, 1)
})
test("Matsukiyo splits categories that exceed the search window", async () => {
  const child = { id: "001:00101", name: "child" }
  const category = { id: "001", name: "parent", sub: [child] }
  const requests = []
  const result = await fetchCatalog({ fetchImpl: async (url) => {
    requests.push(url)
    return { ok: true, text: async () => {
      if (url.endsWith("robots.txt")) return "User-agent: *\nAllow: /"
      const selected = JSON.parse(new URL(url).searchParams.get("categories") || "null")
      const html = page([{ sku: "4901301452085", product_name: "商品" }], selected?.[child.id] ? 1 : 4000)
      return selected ? html : `${html}<input name="factcategories" value='${JSON.stringify([category]).replaceAll('"', '&quot;')}'>`
    } }
  } })
  assert.equal(result.products.length, 1)
  assert.equal(result.coverage[0].id, child.id)
  assert.equal(requests.length, 4)
})
