import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMoriDetail } from '../scripts/parse-mori-details.mjs'
test('Mori preserves classed phone and multiline address, rejects navigation pages', () => {
  const result = parseMoriDetail('<h1 class="ttl"><span>今宿店</span></h1><dt>住所</dt><dd>〒819-0169<br>福岡県福岡市西区今宿西1丁目16番10号</dd><dt>電話番号</dt><dd class="tel">092-805-6030</dd><dt>営業時間</dt><dd>9:00-24:00</dd>', 'https://www.doramori.co.jp/test/', '2026-09-13T00:00:00Z')
  assert.equal(result.phone, '092-805-6030')
  assert.equal(result.address, '福岡県福岡市西区今宿西1丁目16番10号')
  assert.equal(result.hours, '9:00-24:00')
  assert.equal(result.lat, null)
  assert.equal(parseMoriDetail('<h1 class="ttl">恒久店</h1><dt>住所</dt><dd>〒 880-0916<br>宮崎県宮崎市大字恒久4378-2</dd>', 'https://www.doramori.co.jp/test/', '2026-09-13').address, '宮崎県宮崎市大字恒久4378-2')
  assert.throws(() => parseMoriDetail('<h1 class="ttl">Privacy</h1>', 'https://www.doramori.co.jp/privacy/', '2026-09-13'))
})
