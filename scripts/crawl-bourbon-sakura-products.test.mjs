import assert from 'node:assert/strict'
import test from 'node:test'
import { directoryLinks, parseProduct, uniqueProducts } from './crawl-bourbon-sakura-products.mjs'
const bUrl = 'https://www.bourbon.co.jp/product/detail/36075-01.html'
const bourbon = `<meta property="og:url" content="${bUrl}"><span class="rt_cf_p_product_name">&#65299;&#65298;本エリーゼ &lt;特別&gt;</span><td class="rt_cf_p_jan_code">4901360360758</td><td class="rt_cf_p_internal_capacity">32本（2本×16袋）</td><img src="/product_file/main.jpg" alt="３２本エリーゼ &lt;特別&gt;" class="rt_cf_p_main_img1">`
const sUrl = 'https://www.sakurasyokuhin.jp/products/kuroppu/'
const sakura = `<link rel="canonical" href="${sUrl}"><p class="h4">黒糖くろっぷ</p><img src="/skrweb/main.jpg" alt="商品画像"><table><tr><td>規格（容量・重量）</td><td>120ｇ（15ｇ×8個）</td></tr><tr><td>入数</td><td>12袋</td></tr><tr><td>荷姿</td><td>15g×8個×12袋</td></tr><tr><td>JANコード</td><td>4905312002369</td></tr><tr><td>ITFコード</td><td>14905312002366</td></tr></table><p class="h4">English name</p>`
test('main identity, entities and native multipack remain explicit', () => {
  const wrapped = parseProduct(bourbon.replace('&#65299;&#65298;本エリーゼ &lt;特別&gt;</span>', '&#65299;&#65298;本エリーゼ<br>&lt;特別&gt;</span>'), bUrl, 'bourbon'); assert.equal(wrapped.reason, undefined)
  const b = parseProduct(bourbon, bUrl, 'bourbon'); assert.equal(b.name, '３２本エリーゼ <特別>'); assert.equal(b.pack, '32本（2本×16袋）'); assert.equal(b.brand, '')
  const s = parseProduct(sakura, sUrl, 'sakura'); assert.equal(s.barcode, '4905312002369'); assert.equal(s.pack, '120ｇ（15ｇ×8個）'); assert.equal(s.imageUrl, 'https://www.sakurasyokuhin.jp/skrweb/main.jpg')
})
test('ambiguous tables/fields, bad GTIN and URL/image mismatches hold', () => {
  for (const html of [bourbon.replace('4901360360758', '4901360360759'), bourbon + '<td class="rt_cf_p_jan_code">4901360360758</td>', bourbon.replace(bUrl, bUrl.replace('36075', '99999')), bourbon.replace('/product_file/main.jpg', 'https://example.com/main.jpg'), bourbon.replace('/product_file/main.jpg', '/main.pdf'), bourbon.replace('alt="３２本エリーゼ &lt;特別&gt;"', 'alt="別の商品"')]) assert.ok(parseProduct(html, bUrl, 'bourbon').reason)
  assert.ok(parseProduct(sakura + '<table><td>JANコード</td><td>4905312002369</td></table>', sUrl, 'sakura').reason)
  assert.ok(parseProduct(sakura.replace('規格（容量・重量）', '荷姿'), sUrl, 'sakura').reason)
})
test('same JAN different name or pack excludes every member, unrelated rows continue', () => {
  const row = parseProduct(bourbon, bUrl, 'bourbon'), other = parseProduct(sakura, sUrl, 'sakura')
  const r = uniqueProducts([row, { ...row, pack: '64本' }, { ...row, name: 'Different' }, other]); assert.equal(r.rows.length, 1); assert.equal(r.rows[0].barcode, other.barcode); assert.equal(r.excluded.length, 3)
})
test('directory accepts only listed same-site product details', () => {
  assert.deepEqual(directoryLinks('<a href="/product/detail/36075-01.html"></a><a href="https://other.example/a"></a>', 'bourbon'), [bUrl])
  assert.deepEqual(directoryLinks(`<a href="${sUrl}"></a><a href="https://www.sakurasyokuhin.jp/products/feed/"></a>`, 'sakura'), [sUrl])
})

test('known snapshot rejects missing, non-string, invalid or noncanonical identifiers', async () => {
  const { knownBarcodes } = await import('./crawl-bourbon-sakura-products.mjs')
  assert.ok(knownBarcodes({ canonicalBarcodes: ['04901360360758'] }).has('04901360360758'))
  for (const snapshot of [{}, { canonicalBarcodes: null }, { canonicalBarcodes: [4901360360758] }, { canonicalBarcodes: ['4901360360758'] }, { canonicalBarcodes: ['not-a-barcode'] }]) assert.throws(() => knownBarcodes(snapshot), /Invalid canonicalBarcodes/)
})
test('failed transport caches require online retry with backup or offline failure; access denial always stops', async () => {
  const { cacheAction } = await import('./crawl-bourbon-sakura-products.mjs')
  assert.equal(cacheAction({ status: 200, url: bUrl }, true), 'use')
  assert.equal(cacheAction({ error: 'timeout', url: bUrl }, false), 'retry')
  assert.throws(() => cacheAction({ error: 'timeout', url: bUrl }, true), /Transport failure/)
  for (const status of [403, 429]) for (const offline of [true, false]) assert.throws(() => cacheAction({ status, url: bUrl }, offline), /Hard stop/)
})

test('HTTP page/server failures terminate; definite image 404/non-image stays a visible hold', async () => {
  const { pageBody, imageHeadReason } = await import('./crawl-bourbon-sakura-products.mjs')
  assert.equal(pageBody({ status: 200, contentType: 'text/html', html: 'ok' }), 'ok')
  for (const status of [404, 500, 503]) assert.throws(() => pageBody({ status, contentType: 'text/html', html: 'error' }), /Unusable page/)
  assert.throws(() => imageHeadReason({ status: 503 }), /Image HTTP503/)
  assert.ok(imageHeadReason({ status: 404, contentType: 'text/html' }))
  assert.ok(imageHeadReason({ status: 200, contentType: 'application/pdf' }))
  assert.equal(imageHeadReason({ status: 200, contentType: 'image/jpeg' }), null)
})
