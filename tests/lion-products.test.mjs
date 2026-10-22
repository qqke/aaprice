import test from 'node:test'
import assert from 'node:assert/strict'
import {parseLionProduct} from '../scripts/crawl-lion-products.mjs'

test('Lion accepts explicit JAN8/JAN13 child identities and rejects internal IDs/checksum errors', () => {
  const parsed = parseLionProduct({id: 473, jan: '4903301241447', name: 'Parent only', image_url: '//doc.lion.co.jp/image.png',
    children: [{jan: '49795462', name: 'ＮＯＮＩＯ ４５ｇ'}, {jan: '4903301241447', name: 'クリニカ 130g'},
      {jan: '473', name: 'Internal ID'}, {jan: '49795463', name: 'Bad check'}]}, 473)
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rejected.length, 2)
  assert.equal(parsed.rows[0].sourceUrl, 'https://map.lion.co.jp/?product=473')
  assert.equal(parsed.rows[0].imageUrl, 'https://doc.lion.co.jp/image.png')
  assert.equal(parsed.rows[0].name, 'ＮＯＮＩＯ ４５ｇ')
  assert.throws(() => parseLionProduct({id: 1, children: []}, 473), /Invalid/)
  assert.throws(() => parseLionProduct({children: []}, 473), /Invalid/)
  assert.throws(() => parseLionProduct({id: 473}, 473), /Invalid/)
})
