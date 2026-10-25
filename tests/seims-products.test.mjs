import test from "node:test"
import assert from "node:assert/strict"
import { parseSeimsList, verifySeimsDetail, recordSeimsCoverage } from "../scripts/crawl-seims-products.mjs"
const url = "https://www.seims.co.jp/shop/c/c10/"
const html = (code = "4560389400083", image = code, name = "点鼻薬 30ml") => `<link rel="next" href="https://www.seims.co.jp/shop/c/c10_p2/"><span class="pager-count"><span>2252</span></span><li class="block-pickup-list-p--item js-enhanced-ecommerce-item"><div class="block-pickup-list-p--goods-name"><a href="/shop/g/g${code}/">${name}</a></div><a data-category="点鼻薬(100304)" data-brand=""><img src="/img/goods/S/${image}.jpg" alt="${name}"></a></li>`
test("Seims binds each list name to the same product URL and main image", () => { const p = parseSeimsList(html(), url); assert.equal(p.rows[0].barcode, "4560389400083"); assert.equal(p.rows[0].category, "点鼻薬"); assert.equal(p.total, 2252); assert.equal(p.next, "https://www.seims.co.jp/shop/c/c10_p2/"); assert.equal(parseSeimsList(html("4560389400083", "4903301316039"), url).rows.length, 0) })
test("Seims excludes invalid identities, local codes and shop bundles", () => { for (const h of [html("4560389400084"), ...["2220000000253", "0405048569630", "0205048569636", "405048569630", "00405048569630"].map(x => html(x)), html("4560389400083", "4560389400083", "点鼻薬 3個セット")]) assert.equal(parseSeimsList(h, url).rows.length, 0); assert.throws(() => parseSeimsList(html(), "https://example.com/shop/c/c10/")); assert.throws(() => parseSeimsList("", url)) })
test("Seims only releases candidates supported by current detail metadata", () => {
  const row = parseSeimsList(html(), url).rows[0]
  const detail = `<meta property="metatag:goods_detail" content="${JSON.stringify({ goods: row.barcode, name: row.name, set_fg: "0" }).replaceAll('"', '&quot;')}"><link rel="canonical" href="${row.sourceUrl}"><meta property="og:image" content="https://www.seims.co.jp/img/goods/L/${row.barcode}.jpg"><dd id="spec_goods">${row.barcode}</dd>`
  assert.equal(verifySeimsDetail(detail, row).barcode, row.barcode)
  assert.equal(verifySeimsDetail(detail.replace('L/4560389400083.jpg', 'L/4560389400083_abc012.jpg'), row).barcode, row.barcode)
  assert.throws(() => verifySeimsDetail(detail.replace('L/4560389400083.jpg', 'L/45603894000834.jpg'), row))
  assert.throws(() => verifySeimsDetail(detail.replace('L/4560389400083.jpg', 'L/4903301316039.jpg'), row))
  assert.throws(() => verifySeimsDetail(detail.replace('&quot;set_fg&quot;:&quot;0&quot;', '&quot;set_fg&quot;:&quot;1&quot;'), row))
  assert.throws(() => verifySeimsDetail(detail, { ...row, name: "Other pack size" }))
})
test("Seims permits same-code hashed images but rejects another numeric code", () => {
  assert.equal(parseSeimsList(html("4560389400083", "4560389400083_abc012"), url).rows.length, 1)
  assert.equal(parseSeimsList(html("4560389400083", "45603894000834"), url).rows.length, 0)
  assert.equal(parseSeimsList(html("4560389400083", "4560389400083", "テスト 2&#215;3cm"), url).rows[0].name, "テスト 2×3cm")
})
test("Seims completeness counts all unique card URLs and notices changing totals", () => {
  const parsed = parseSeimsList(html("4560389400084"), url)
  assert.equal(parsed.rows.length, 0); assert.equal(parsed.cardUrls.length, 1)
  const page = { ...parsed, total: 2 }, seen = new Set()
  let coverage = recordSeimsCoverage(null, page, seen)
  coverage = recordSeimsCoverage(coverage, page, seen)
  assert.equal(coverage.observed, 2); assert.equal(coverage.unique, 1); assert.equal(coverage.complete, false)
  coverage = recordSeimsCoverage(coverage, { ...page, cardUrls: ["https://www.seims.co.jp/shop/g/g4560389400083/"] }, seen)
  assert.equal(coverage.complete, true)
  coverage = recordSeimsCoverage(coverage, { ...page, total: 3 }, seen)
  assert.equal(coverage.totalChanged, true); assert.equal(coverage.complete, false)
})
