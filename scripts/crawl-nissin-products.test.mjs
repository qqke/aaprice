import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProduct, uniqueProducts } from './crawl-nissin-products.mjs'
test('Myojo native multipack contents survive; carton logistics and numeric itemID never become JAN', () => {
  const url = 'https://www.myojofoods.co.jp/products/items/13357/', image = 'https://cdn.nissin.com/image?id=13357&s=720'
  const api = { id: 13357, is_official: true, name: '明星 しょうゆ 5食パック', jan: '4902881000543', net_amount: '97g (90g)', image_url: image, company_label: '明星食品' }
  const html = `<link rel="canonical" href="${url}"><h1 class="ns-headline_01">${api.name}</h1><figure class="ns-p-item__main__figure"><img src="${image}"></figure><div class="ns-p-item__main__item-spec"><dl><dt>JANコード</dt><dd>${api.jan}</dd></dl><dl><dt>内容量 (麺量)</dt><dd>97g (90g) ×5食</dd></dl><dl><dt>荷 姿</dt><dd>1ケース(5食×6パック入)</dd></dl></div>`
  const row = parseProduct(html, api, url, 'myojo')
  assert.equal(row.pack, '97g (90g) ×5食'); assert.equal(row.barcode, api.jan); assert.equal(row.manufacturer, '明星食品'); assert.equal(row.brand, '')
  assert.equal(parseProduct(html, { ...api, jan: api.jan + '\t' }, url, 'myojo').barcode, api.jan)
  assert.match(parseProduct(html.replace(api.jan, '13357'), api, url, 'myojo').reason, /GTIN/)
  assert.match(parseProduct(html, { ...api, id: 1 }, url, 'myojo').reason, /identity/)
  assert.match(parseProduct(html, { ...api, image_url: image + 'x' }, url, 'myojo').reason, /image/)
  assert.match(parseProduct(html.replace('</div>', '<dl><dt>JANコード</dt><dd>4902881000543</dd></dl></div>'), api, url, 'myojo').reason, /ambiguous/)
  const grouped = uniqueProducts([row, { ...row, pack: '97g' }, row]); assert.equal(grouped.rows.length, 0); assert.equal(grouped.excluded.length, 3)
})
test('Nissin native contents agree with page/API without requiring absent canonical', () => {
  const url = 'https://www.nissin.com/jp/product/items/13462/', image = 'https://cdn.nissin.com/image?id=13462&s=720'
  const api = { id: 13462, is_official: true, name: 'カップヌードル', jan: '49698626', net_amount: '78g (65g)', image_url: image }
  const html = `<meta property="og:url" content="${url}"><h1>${api.name}</h1><div class="ItemDetail__image -pc"><img src="${image}"></div><table><tr><th>JANコード</th><td>${api.jan}</td></tr><tr><th>内容量 (麺量)</th><td>78g (65g)</td></tr></table>`
  const row = parseProduct(html, api, url, 'nissin'); assert.equal(row.barcode, '49698626'); assert.equal(row.brand, '')
  assert.match(parseProduct(html, { ...api, net_amount: '88g' }, url, 'nissin').reason, /disagree/)
})
