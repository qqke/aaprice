import test from "node:test"
import assert from "node:assert/strict"
import { parseCreateList, verifyCreateProduct } from "../scripts/crawl-create-products.mjs"
import { validGtin } from "../scripts/import-new-products.mjs"

const barcode = "4901301448361", sourceUrl = `https://netshop.create-sd.co.jp/shop/g/g${barcode}/`
const card = `<div class="StyleD_Item_"><img src="/img/goods/S/${barcode}.jpg"><a class="goods_name_" href="/shop/g/g${barcode}/">A&amp;B</a><a href="/shop/cart/cart.aspx?goods=${barcode}">buy</a>`
test("Create accepts consistent card identity and rejects cart conflicts and local codes", () => {
  const wrap = html => `<span class="navipage_sum_"><strong>1</strong></span><div class="goods_ goods_list_">${html}<div class="navipage_ bottom_">`
  assert.equal(parseCreateList(wrap(card)).products[0].name, "A&B")
  assert.equal(parseCreateList(wrap(card.replace(`goods=${barcode}`, "goods=other"))).excluded.length, 1)
  assert.equal(parseCreateList(wrap(card.replaceAll(barcode, "2220000000253"))).excluded.length, 1)
  for (const prefix of ["020", "040", "200"]) {
    const body = `${prefix}123456789`
    const code = body + ((10 - [...body].reverse().reduce((sum, n, i) => sum + Number(n) * (i % 2 ? 1 : 3), 0) % 10) % 10)
    for (const restricted of [code, `0${code}`, ...(code.startsWith("0") ? [code.slice(1)] : [])]) {
      assert.equal(validGtin(restricted), true)
      assert.equal(parseCreateList(wrap(card.replaceAll(barcode, restricted))).excluded.length, 1)
    }
  }
  assert.equal(parseCreateList(wrap(card.replace("A&amp;B", "《セット販売》A"))).excluded.length, 1)
})
test("Create detail requires labelled product code, hidden identity, name, canonical URL and own image", () => {
  const html = `<link rel="canonical" href="${sourceUrl}"><input type="hidden" value="${barcode}" id="hidden_goods"><a href="/img/goods/L/${barcode}.jpg" class="img_"><p class="title_">商品名 : </p><p class="txt_">A&amp;B</p><p class="title_">商品コード : </p><p class="txt_">${barcode}</p>`
  const expected = {barcode, sourceUrl, name: "A&B"}
  assert.equal(verifyCreateProduct(html, expected), true)
  assert.equal(verifyCreateProduct(html, {...expected, barcode: "4901301448362"}), false)
  assert.equal(verifyCreateProduct(html.replace(sourceUrl, "https://evil.invalid/"), expected), false)
  assert.equal(verifyCreateProduct(html.replace("商品コード", "関連商品"), expected), false)
})
