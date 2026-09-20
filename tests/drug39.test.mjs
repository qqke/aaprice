import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDrug39 } from '../scripts/crawl-drug39.mjs'
test('Drug39 retains pharmacy-only exclusions and never promotes viewport centers to store coordinates',()=>{
 const html='<title>サンキュードラッグ 海峡店 | 店舗</title>店舗基本情報</h2><p class="txt_address">下関市一丁目</p><span class="label_service_a">ドラッグ</span><th>電話番号</th><td>083-123-4567</td><iframe src="!2d130.9!3d33.9"></iframe>'
 const s=parseDrug39(html,'https://www.drug39.co.jp/store_info/shimonosekishi/entry-123.html','2026-09-13T00:00:00Z')
 assert.equal(s.address,'山口県下関市一丁目'); assert.equal(s.phone,'083-123-4567');assert.equal(s.lat,null);assert.deepEqual(s.approximateMapCenter,{lat:33.9,lng:130.9})
 assert.throws(()=>parseDrug39(html.replace('label_service_a','label_service_b'),'https://www.drug39.co.jp/store_info/entry-123.html','now'),/No retail/)
})
