import test from 'node:test'
import assert from 'node:assert/strict'
import { parseZagzag } from '../scripts/crawl-zagzag.mjs'

const sample = `<title>吉原店 | ザグザグ</title><div>住所</div><div>〒578-0904 大阪府東大阪市吉原二丁目3番22号</div><iframe src="https://www.google.com/maps/embed?pb=!1d820!2d135.624060!3d34.685416!2m3"></iframe><h3 class="shop-single__label -main fff">店舗</h3><table><tr><th>営業時間</th><td>9:00～24:00</td></tr><tr><th>電話番号</th><td>072-965-1539</td></tr></table><h3>調剤薬局</h3><table><th>営業時間</th><td>9:00～18:00</td><th>電話番号</th><td>000-000-0000</td></table>`
test('ZAGZAG preserves map-center precision and selects retail contact information', () => {
  const row = parseZagzag(sample, 'https://www.zagzag.co.jp/shops/yoshihara/', '2026-09-13T00:00:00Z')
  assert.equal(row.phone, '072-965-1539')
  assert.equal(row.hours, '9:00～24:00')
  assert.equal(row.lat, 34.685416)
  assert.equal(row.coordinateAccuracy, 'map-center')
  assert.equal(row.pref, '大阪府')
})
test('ZAGZAG excludes dispensing-only and closed stores, retains missing-coordinate address separately', () => {
  const url = 'https://www.zagzag.co.jp/shops/test/'
  assert.throws(() => parseZagzag(sample.replace('>店舗</h3>', '>調剤薬局</h3>'), url, ''), /active retail/)
  assert.throws(() => parseZagzag(sample.replace('9:00～24:00', '休業中'), url, ''), /opening hours/)
  assert.equal(parseZagzag(sample.replace(/<iframe[^>]*><\/iframe>/, ''), url, '').lat, null)
})

