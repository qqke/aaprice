import assert from "node:assert/strict"
import test from "node:test"
import { parseKyorindoList, parseKyorindoProduct } from "../scripts/crawl-kyorindo-products.mjs"

const url = "https://www.kyorindo-onlineshop.jp/shop/g/g4582521683642/"
const product = { "@type": "Product", name: "ティアラル 13mL", mpn: "4582521683642", image: "https://www.kyorindo-onlineshop.jp/img/goods/S/4582521683642.jpg" }
const detail = p => `<dd id="spec_goods">4582521683642</dd><script type="application/ld+json">${JSON.stringify(p)}</script>`
test("Kyorindo requires code, structured Product and current image identity", () => {
  assert.equal(parseKyorindoProduct(detail(product), url).barcode, product.mpn)
  assert.equal(parseKyorindoProduct(detail({ ...product, mpn: "4903301010944" }), url), null)
  assert.equal(parseKyorindoProduct(detail({ ...product, image: "https://www.kyorindo-onlineshop.jp/img/4903301010944.jpg" }), url), null)
  assert.equal(parseKyorindoProduct(detail({ ...product, name: "【セット販売】2個" }), url), null)
  assert.ok(parseKyorindoProduct(detail({ ...product, name: "メーカー原生セット" }), url))
  assert.throws(() => parseKyorindoProduct(detail(product), url.replace("www.kyorindo-onlineshop.jp", "invalid.test")))
  for (const code of ["2220000000253", "0405048569630", "0205048569636"]) {
    const local = detail(product).replaceAll("4582521683642", code)
    assert.equal(parseKyorindoProduct(local, url.replace("4582521683642", code)), null)
  }
})
test("Kyorindo current list excludes surrounding recommendation links", () => {
  const html = '<a href="/shop/g/g4903301010944/">other</a><div class="block-goods-list--pager-top"><span class="pager-count"><span>1</span></span><dl class="block-thumbnail-t--goods"><a href="/shop/g/g4582521683642/">item</a></dl><div class="block-goods-list--pager-bottom">'
  assert.deepEqual(parseKyorindoList(html), { total: 1, urls: [url] })
  assert.throws(() => parseKyorindoList(html.replace('>1<', '>0<')), /count/)
})
