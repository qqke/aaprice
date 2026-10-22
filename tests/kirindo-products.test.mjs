import test from "node:test"
import assert from "node:assert/strict"
import { parseKirindoList, parseKirindoProduct } from "../scripts/crawl-kirindo-products.mjs"

test("Kirindo lists are discovery only; details require explicit valid gtin13", () => {
  const url = "https://www.kirindo-shop.com/c/a/4543802604855"
  assert.equal(parseKirindoList('<span class="fs-c-listControl__status__total">1</span><h2 class="fs-c-productListItem__productName"><a href="/c/a/4543802604855"><span class="fs-c-productName__name">A&amp;B</span></a></h2>').products[0].name, "A&B")
  const html = product => `<script type="application/ld+json">${JSON.stringify(product)}</script>`
  const product = { "@type": "Product", gtin13: "4543802604855", name: "A&amp;B", url }
  assert.equal(parseKirindoProduct(html(product), url).barcode, product.gtin13)
  assert.equal(parseKirindoProduct(html({ ...product, gtin13: "4543802604856" }), url), null)
  assert.equal(parseKirindoProduct(html({ ...product, gtin13: undefined, sku: product.gtin13 }), url), null)
  assert.throws(() => parseKirindoProduct(html(product), `${url}x`), /mismatch/)
})
