import { strict as assert } from 'node:assert'
import { parseProduct, links, uniqueProducts } from './crawl-fujiyaku-products.mjs'
const url = 'https://www.fujiyaku-direct.com/shop/g/g498752403263n/'
const mainImage = '<li class="block-goods-gallery--src-l"><a href="/img/goods/L/498752403263n.jpg"><img src="/img/usr/lazyloading.png"></a></li>'
const spec = jan => `<meta property="etm:goods_detail" content="{&quot;goods&quot;:&quot;498752403263n&quot;}">${mainImage}<dl class="goods-detail-description block-goods-spec"><dt>その他</dt><dd>●JANコード<br>${jan}</dd></dl>`
const sample = `<h1>ジキナ顆粒ゴールド（6包）</h1>${spec('4987524032631')}<div class="pane-goods-footer">${spec('4987524033454')}</div>`
assert.equal(parseProduct(sample, url).barcode, '4987524032631')
assert.match(parseProduct(sample, url).name, /6包/)
assert.equal(parseProduct(sample, url).imageUrl, 'https://www.fujiyaku-direct.com/img/goods/L/498752403263n.jpg')
assert.equal(parseProduct(sample, url.replace('498752403263n', 'different')).reason, 'Product metadata identity mismatch')
assert.equal(parseProduct(sample.replace('/img/goods/L/498752403263n.jpg', '/img/goods/L/different.jpg'), url).reason, 'Main image product identity mismatch')
const product = parseProduct(sample, url)
assert.equal(uniqueProducts([product, {...product}]).rows.size, 1)
const conflict = uniqueProducts([product, {...product, pack: 'different'}])
assert.equal(conflict.rows.size, 0)
assert.equal(conflict.excluded.length, 2)
assert.equal(parseProduct(sample.replace(mainImage, ''), url).reason, 'Missing official main product image')
assert.equal(parseProduct(sample.replace(mainImage, '') + mainImage, url).reason, 'Missing official main product image')
assert.equal(parseProduct(sample.replace('/img/goods/L/498752403263n.jpg', 'https://evil.test/image.jpg'), url).reason, 'Missing official main product image')
assert.equal(parseProduct(sample.replace('●JANコード', '●商品番号'), url).reason, 'Missing or ambiguous explicit JAN')
assert.equal(parseProduct(sample.replace('4987524032631', '4987524032632'), url).reason, 'Invalid or restricted GTIN')
assert.equal(parseProduct(sample.replace('4987524032631', '2000000000008'), url).reason, 'Invalid or restricted GTIN')
assert.equal(parseProduct(sample.replace('4987524032631', '4987524032631 / 4987524033454'), url).reason, 'Missing or ambiguous explicit JAN')
assert.equal(parseProduct(sample.replace('ジキナ顆粒ゴールド（6包）', 'ジキナ顆粒ゴールド 2個セット'), url).reason, 'Subscription or shop bundle')
assert.equal(parseProduct(sample.replace('<div class="pane-goods-footer">', spec('4987524033454') + '<div class="pane-goods-footer">'), url).reason, 'Missing or ambiguous explicit JAN')
assert.equal(parseProduct(`<h1>メーカー原包装10本入</h1>${spec('4987524032631')}`, url).barcode, '4987524032631')
assert.equal(parseProduct(`<meta property="etm:goods_detail" content="{&quot;set_fg&quot;:&quot;1&quot;}">${sample}`, url).reason, 'Subscription or shop bundle')
assert.deepEqual(links(`<a href="/shop/g/g123n/"></a><a href="https://evil.test/shop/g/g123n/"></a>`, /^\/shop\/g\//), ['https://www.fujiyaku-direct.com/shop/g/g123n/'])
console.log('Fuji primary explicit JAN, ambiguity, bundle, original packaging, checksum and origin checks passed')
