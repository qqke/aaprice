import test from 'node:test'
import assert from 'node:assert/strict'
import {parseKaoCatalog} from '../scripts/crawl-kao-products.mjs'

test('Kao catalog retains official JAN identities, deduplicates and rejects mismatched product URLs', () => {
  const product = {janCode: '4973167049969', dispName: 'ケイト リムーバー', brand: {dispName: 'ケイト'},
    category: {dispName: 'クレンジング'}, images: {src: '//kao-h.assetsadobe3.com/image.jpg'},
    pageUrl: 'https://www.kao-kirei.com/ja/item/kbb/kate/4973167049969/', expiredProductsFlag: true}
  const parsed = parseKaoCatalog({productList: [product, product, {...product, janCode: '4973167049960'},
    {...product, pageUrl: 'https://www.kao-kirei.com/ja/item/kbb/kate/4901301459374/'},
    {...product, pageUrl: 'https://example.com/ja/item/4973167049969/'}]})
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.rejected.length, 3)
  assert.equal(parsed.discontinuedRows, 5)
  assert.deepEqual(parsed.rows[0], {barcode: product.janCode, name: product.dispName, brand: 'ケイト', pack: '',
    category: 'クレンジング', description: '', imageUrl: 'https://kao-h.assetsadobe3.com/image.jpg', catalogSource: 'kao', sourceUrl: product.pageUrl})
  assert.throws(() => parseKaoCatalog({productList: []}), /Empty or invalid/)
})
