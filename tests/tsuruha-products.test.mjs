import test from "node:test"
import assert from "node:assert/strict"
import { parseTsuruhaProduct, parseTsuruhaSitemap, parseTsuruhaApi } from "../scripts/crawl-tsuruha-products.mjs"

test("Tsuruha uses labelled JAN, never the internal product ID or related items", () => {
  const html = '<span itemprop="name">商品 &amp; 名前</span><dt>商品番号(JANコード)</dt><dd>4987433110185</dd><p>4901301234567</p><meta property="og:image" content="https://shop.tsuruha.co.jp/p.jpg?a=1&amp;b=2">'
  const row = parseTsuruhaProduct(html, "https://shop.tsuruha.co.jp/10171467.html")
  assert.equal(row.barcode, "4987433110185")
  assert.equal(row.name, "商品 & 名前")
  assert.equal(row.imageUrl, "https://shop.tsuruha.co.jp/p.jpg?a=1&b=2")
  assert.equal(parseTsuruhaProduct(html.replace("4987433110185", "4987433110184"), row.sourceUrl), null)
  assert.equal(parseTsuruhaProduct(html.replace(/商品番号\(JANコード\)/, "商品番号"), row.sourceUrl), null)
  assert.equal(parseTsuruhaProduct(html.replace("商品 &amp; 名前", "《セット販売》商品3個"), row.sourceUrl), null)
  assert.throws(() => parseTsuruhaProduct(html, "https://example.com/10171467.html"))
})

test("Tsuruha sitemap discovery excludes categories and other origins", () => {
  assert.deepEqual(parseTsuruhaSitemap('<url><loc>https://shop.tsuruha.co.jp/10171467.html</loc><image:title>A &amp; B</image:title></url><url><loc>https://shop.tsuruha.co.jp/123/234.html</loc></url><url><loc>https://evil.test/10171467.html</loc></url>'), [{ url: "https://shop.tsuruha.co.jp/10171467.html", name: "A & B" }])
})

test("Tsuruha API reads JAN attribute and checks its SKU/URL association", () => {
  const product = { sku: "10171467", url_key: "10171467", name: "商品", custom_attributesV2: { items: [{ code: "tgmd_bulk_jan_code", value: "4901301234567" }, { code: "tgmd_jan_code", value: "4987433110185" }] } }
  assert.equal(parseTsuruhaApi(product, new Set([product.sku])).barcode, "4987433110185")
  assert.throws(() => parseTsuruhaApi(product, new Set(["10187187"])))
  assert.throws(() => parseTsuruhaApi({ ...product, url_key: "different" }, new Set([product.sku])))
  assert.equal(parseTsuruhaApi({ ...product, custom_attributesV2: { items: [] } }, new Set([product.sku])), null)
  assert.equal(parseTsuruhaApi({ ...product, custom_attributesV2: { items: [{ code: "tgmd_jan_code", value: "10171467" }] } }, new Set([product.sku])), null)
  assert.throws(() => parseTsuruhaApi({ ...product, name: "《セット販売》商品3個セット" }, new Set([product.sku])), /bundle/)
  assert.throws(() => parseTsuruhaApi({ ...product, name: "《セット》商品3個" }, new Set([product.sku])), /bundle/)
  assert.equal(parseTsuruhaApi({ ...product, name: "メーカー トライアルセット" }, new Set([product.sku])).barcode, "4987433110185")
})
