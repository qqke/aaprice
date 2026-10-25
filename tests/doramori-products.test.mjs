import test from "node:test"
import assert from "node:assert/strict"
import { parseDoramoriProduct } from "../scripts/crawl-doramori-products.mjs"

const url = "https://net-shop.doramori.co.jp/i/4560371872676"
const product = { "@type": "Product", sku: "4560371872676", name: "クレンジングジェル 100g", image: ["https://net-shop.doramori.co.jp/img/item/4560371872676/4560371872676.jpg"], offers: { url } }
const html = p => `<link rel="canonical" href="${url}"/><script type="application/ld+json">${JSON.stringify(p)}</script>`

test("Doramori requires current Product identity to agree with canonical, offer and image", () => {
  assert.equal(parseDoramoriProduct(html(product), url).barcode, product.sku)
  assert.throws(() => parseDoramoriProduct(html({ ...product, sku: "4560371872677" }), url), /identity/)
  assert.throws(() => parseDoramoriProduct(html({ ...product, image: ["https://net-shop.doramori.co.jp/img/4901301234568.jpg"] }), url), /agree/)
  assert.throws(() => parseDoramoriProduct(html({ ...product, offers: { url: `${url}x` } }), url), /agree/)
  assert.throws(() => parseDoramoriProduct(html(product) + html(product), url), /unambiguous/)
})

test("Doramori excludes shop bundles and local-circulation IDs", () => {
  assert.throws(() => parseDoramoriProduct(html({ ...product, name: "【セット品】テスト" }), url), /bundle/)
  for (const sku of ["2220000000253", "0405048569630", "0205048569636", "405048569630", "00405048569630"]) assert.throws(() => parseDoramoriProduct(html({ ...product, sku }), url), /identity/)
  assert.equal(parseDoramoriProduct(html({ ...product, name: "メーカー原生 トライアルセット" }), url).name, "メーカー原生 トライアルセット")
})
