import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProduct, uniqueProducts } from './crawl-suntory-products.mjs'
test('native main fields must agree with structured JAN, name, image and canonical', () => {
  const url = 'https://products.suntory.co.jp/d/45191763/', name = '烏龍茶 & <Native>', image = 'https://www.suntory.co.jp/products/pimg/TEA.jpg'
  const html = `<link rel="canonical" href="${url}"><div id="product"><h2>烏龍茶 &amp; &lt;Native&gt;</h2><p id="product_img"><img src="${image}" alt="烏龍茶 &amp; &lt;Native&gt;"><dl id="product_detail_standard"><dt>JANコード</dt><dd>45191763</dd><dt>容量</dt><dd>600ml</dd></dl><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: '烏龍茶 &amp; &lt;Native&gt;', url, image, gtin13: '45191763', brand: { name: 'SUNTORY' } })}</script>`
  const row = parseProduct(html, url)
  assert.equal(row.barcode, '45191763'); assert.equal(row.pack, '600ml'); assert.equal(row.brand, 'SUNTORY'); assert.equal(row.name, name)
  assert.match(parseProduct(html.replace('<dd>45191763', '<dd>45191764'), url).reason, /GTIN/)
  assert.match(parseProduct(html.replace('gtin13":"45191763', 'gtin13":"4901777231672'), url).reason, /disagree/)
  assert.match(parseProduct(html.replace('</dl>', '<dt>容量</dt><dd>500ml</dd></dl>'), url).reason, /ambiguous/)
  assert.match(parseProduct(html, url.replace('45191763', '4901777231672')).reason, /Canonical/)
  const grouped = uniqueProducts([row, { ...row, pack: '500ml' }, row])
  assert.equal(grouped.rows.length, 0); assert.equal(grouped.excluded.length, 3)
})
