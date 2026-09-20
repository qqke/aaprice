import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOhga, parseEvergreenList, parseEvergreenCoordinates } from '../scripts/crawl-regional-retail.mjs'

test('Ohga accepts explicit retail destination and rejects dispensing-only and closures', () => {
  const block = '<li class="drugstore">ドラッグストア</li><h2>大賀薬局 テスト店</h2><dt>住所</dt><dd>〒810-0001 福岡県福岡市中央区天神1</dd><dt>電話番号</dt><dd>092-123-4567</dd><a href="https://www.google.com/maps/dir/?api=1&destination=33.59,130.40"></a><a href="/shop/detail/?id=123"></a>'
  const s = parseOhga(block, '2026-09-13T10:00:00Z')
  assert.equal(s.address, '福岡県福岡市中央区天神1')
  assert.equal(s.lat, 33.59)
  assert.equal(parseOhga(block.replace('33.59,', '33.59 ,')).lat, 33.59)
  assert.throws(() => parseOhga(block.replace('class="drugstore"','class="dispense"')), /retail/)
  assert.throws(() => parseOhga(block + '閉店のお知らせ'), /review/)
})
test('Evergreen preserves store rows but ignores commented-out listings and map view centers', () => {
  const row = '<tr><th class="td01"> <a href="https://hirooka-g.co.jp/tenpo/example/">エバグリーン<br>テスト店</a></th><td class="td02">和歌山県有田市1<br>TEL.<span>0737-00-0000</span></td><td class="td03">9:00～22:00</td></tr>'
  const stores = parseEvergreenList(row + `<!--${row}-->`, '2026-09-13', 'https://hirooka-g.co.jp/store/store_evergreen/')
  assert.equal(stores.length, 1)
  assert.equal(stores[0].phone, '0737-00-0000')
  assert.equal(parseEvergreenCoordinates('<iframe src="https://www.google.com/maps/embed/v1/place?key=public&q=34.079978, 135.115517&zoom=15">').lng, 135.115517)
  assert.throws(() => parseEvergreenCoordinates('<iframe src="https://www.google.com/maps/embed?pb=!2d135.115!3d34.079">'), /No official place/)
})
