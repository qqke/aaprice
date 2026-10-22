import test from "node:test"
import assert from "node:assert/strict"
import { parseTomodsList, verifyTomodsProduct } from "../scripts/crawl-tomods-products.mjs"

const card = '<dl class="block-goods-detail-j--goods js-enhanced-ecommerce-item"><a href="/shop/g/g4536117051506/"><img data-src="/img/goods/S/4536117051506a.jpg"></a><a class="js-enhanced-ecommerce-goods-name">Name &amp; test</a><a href="/shop/cart/cart.aspx?goods=4536117051506&amp;x=1">Cart</a></dl>'
test("Tomods card requires matching checked code, cart and image", () => {
  const parsed = parseTomodsList(card + '<span class="pager-count"><span>1</span></span>')
  assert.equal(parsed.total, 1)
  assert.equal(parsed.products[0].barcode, "4536117051506")
  assert.equal(parsed.products[0].name, "Name & test")
  assert.equal(parseTomodsList(card.replace("goods=4536117051506", "goods=4901301465108")).products.length, 0)
})
test("Tomods ignores recommendation cards outside current list pagers", () => {
  const html = card + '<div class="block-goods-list--pager-top"><span class="pager-count"><span>1</span></span>' + card + '<div class="block-goods-list--pager-bottom">' + card
  assert.equal(parseTomodsList(html).products.length, 1)
})
test("Tomods sold-out cards can become detail candidates without cart links", () => {
  const withoutCart = card.replace(/<a href="\/shop\/cart\/[\s\S]*?<\/a>/, "")
  const parsed = parseTomodsList(withoutCart)
  assert.equal(parsed.products.length, 1)
  assert.equal(parsed.products[0].evidenceType, "official-catalog-image-code")
  assert.equal(parseTomodsList(card.replace("goods=4536117051506", "goods=4901301465108")).products.length, 0)
})
test("Tomods detail requires code and Product mpn/name/image agreement", () => {
  const expected = { barcode: "4536117051506", name: "Name & test" }
  const html = '<dd id="spec_goods">4536117051506</dd><script type="application/ld+json">' + JSON.stringify({ "@type": "Product", mpn: expected.barcode, name: expected.name, image: "https://tomods-ap.com/img/goods/S/4536117051506a.jpg" }) + '</script>'
  assert.equal(verifyTomodsProduct(html, expected), true)
  assert.equal(verifyTomodsProduct(html.replace('"mpn":"4536117051506"', '"mpn":"4901301465108"'), expected), false)
})
