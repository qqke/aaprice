import assert from "node:assert/strict"
import test from "node:test"
import { parseElpaList, verifyElpaDetail } from "../scripts/crawl-elpa-products.mjs"
const url = "https://www.elpadirect.jp/products/4901087233564/"
const html = `<span class="plg_raku2_product_count_fh">1件</span><form name="product_form11491"><img src="/upload/save_image/products/4901087233564_01.jpg"><h3 class="raku2_list_product_name"><a href="${url}" data-product_code="4901087233564" data-name="エルパ 電球 ELPA" data-maker_name="朝日電器株式会社">エルパ 電球 ELPA</a></h3>JANコード:<span class="product_rcatalog_id_default">4901087233564</span></form>`
test("ELPA requires explicit JAN and matching product card identity", () => {
  assert.equal(parseElpaList(html, url).rows[0].barcode, "4901087233564")
  assert.equal(parseElpaList(html.replace('>4901087233564<', '>4901087233571<'), url).rows.length, 0)
  assert.equal(parseElpaList(html.replaceAll("エルパ 電球 ELPA", "Other manufacturer"), url).rows.length, 0)
  assert.equal(parseElpaList(html.replaceAll("エルパ 電球 ELPA", "エルパ【セット販売】2個"), url).rows.length, 0)
  assert.equal(parseElpaList(html.replaceAll("4901087233564", "0405048569630"), url).rows.length, 0)
  assert.throws(() => parseElpaList(html.replace('>1件<', '>0件<'), url))
})
test("ELPA sample details require title, explicit JAN and canonical URL", () => {
  const row = parseElpaList(html, url).rows[0]
  const d = `<link rel="canonical" href="${url}"><title>エルパ 電球 ELPA ｜ エルパ・ダイレクト</title><span id="product_rcatalog_id_default">4901087233564</span>`
  assert.ok(verifyElpaDetail(d, row))
  assert.equal(verifyElpaDetail(d.replace('>4901087233564<', '>4901087233571<'), row), false)
})
