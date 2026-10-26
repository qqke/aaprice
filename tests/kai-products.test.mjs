import assert from "node:assert/strict"
import test from "node:test"
import { parseKaiList, parseKaiProduct } from "../scripts/crawl-kai-products.mjs"

const url = "https://store.kai-group.com/shop/g/g15671/"
const p = { productCd: "15671", productPageUrl: url, productName: "カミソリ 替刃2個付", jan: "4901331003134", productImageUrl: "https://store.kai-group.com/img/goods/L/main.jpg", categoryName: "カミソリ" }
const fixture = (product = p, set = "0") => `<link rel="canonical" href="${url}"><dl class="block-goods-comment5"><dd>4901331003134</dd></dl><h1 class="block-goods-name--text">${p.productName}</h1><meta property="etm:goods_detail" content="${JSON.stringify({ goods: p.productCd, name: p.productName, set_fg: set }).replaceAll('"', '&quot;')}"><script type="application/json" id="revico-productmaster-data-origin">${JSON.stringify({ productDataList: [product] })}</script>`

test("Kai uses explicitly labelled JAN, not the internal numeric product ID", () => {
  const row = parseKaiProduct(fixture(), url)
  assert.equal(row.barcode, p.jan)
  assert.equal(row.name, p.productName)
  for (const changed of [{ jan: "4903301010944" }, { productCd: "15672" }, { productName: "別商品" }, { productPageUrl: url + "wrong" }]) assert.equal(parseKaiProduct(fixture({ ...p, ...changed }), url), null)
  assert.equal(parseKaiProduct(fixture(p, "1"), url), null)
  assert.equal(parseKaiProduct(fixture().replaceAll(p.productName, `【名入れ対応】${p.productName}`), url), null)
  assert.equal(parseKaiProduct(fixture().replaceAll(p.productName, `${p.productName} / ギフト包装付き(KAI Gift)`), url), null)
  assert.throws(() => parseKaiProduct(fixture(), "https://invalid.test/shop/g/g15671/"))
})

test("Kai variants may canonically reference their official family while retaining their own JAN", () => {
  const variant = { ...p, variationGroup: "series", productImageUrl: "https://store.kai-group.com/img/goods-bulk-upload-2601/current.jpg" }
  const html = fixture(variant).replace(`<link rel="canonical" href="${url}">`, '<link rel="canonical" href="https://store.kai-group.com/shop/g/g15670/">')
  assert.equal(parseKaiProduct(html, url).barcode, p.jan)
  assert.equal(parseKaiProduct(html.replace('"variationGroup":"series"', '"variationGroup":""'), url), null)
  assert.equal(parseKaiProduct(html.replace('href="https://store.kai-group.com/shop/g/g15670/"', 'href="https://invalid.test/shop/g/g15670/"'), url), null)
})

test("Kai list scope excludes recommendations and deduplicates image/name links", () => {
  const html = '<a href="/shop/g/gother/">recommendation</a><div class="block-goods-list--pager-top"><span class="pager-count"><span>1</span></span><a href="/shop/g/g15671/">image</a><a href="/shop/g/g15671/">name</a><div class="block-goods-list--pager-bottom">'
  assert.deepEqual(parseKaiList(html), { total: 1, urls: [url] })
  assert.throws(() => parseKaiList(""), /scope/)
})
