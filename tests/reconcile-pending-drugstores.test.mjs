import assert from 'node:assert/strict'
import {normalizeJapaneseStreet,parseOfficialCoordinateQuery} from '../scripts/reconcile-pending-drugstores.mjs'
import {verifyMarkerAddress} from '../scripts/official-embed-marker.mjs'
assert.equal(normalizeJapaneseStreet('国分広瀬一丁目19番35号'),'国分広瀬1丁目19番35号')
assert.equal(normalizeJapaneseStreet('南一条西二十七丁目1番1号'),'南1条西27丁目1番1号')
assert.equal(normalizeJapaneseStreet('二子玉川ライズ'), '二子玉川ライズ')
assert.equal(normalizeJapaneseStreet('千歳空港国際線3F'),'千歳空港国際線3F')
const row={address:normalizeJapaneseStreet('鹿児島県霧島市国分広瀬一丁目19番35号')}
assert.doesNotThrow(()=>verifyMarkerAddress({coordinateEntityAddress:'鹿児島県霧島市国分広瀬1-19-35'},row))
assert.throws(()=>verifyMarkerAddress({coordinateEntityAddress:'鹿児島県霧島市国分広瀬1-19-36'},row),/numbers differ/)
console.log('Reconciliation: Japanese street numerals normalize exactly, different lots still rejected')
assert.deepEqual(parseOfficialCoordinateQuery('https://maps.google.co.jp/maps?q=36.605101,136.646142&ll=35,135&output=embed'),{lat:36.605101,lng:136.646142})
for(const url of ['https://maps.google.co.jp/maps?ll=36.605101,136.646142&output=embed','https://maps.google.co.jp/maps?q=GENKY&output=embed','https://google.com.evil.example/maps?q=36,136&output=embed','https://maps.google.co.jp/maps?q=0,136&output=embed'])assert.throws(()=>parseOfficialCoordinateQuery(url))
console.log('Official detail explicit coordinate q accepted; viewport ll, named query, foreign hostname and non-Japan points rejected')
