import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCoordinateLabel,parseSugiyama} from '../scripts/crawl-sugiyama.mjs'
import {parseSunroad} from '../scripts/crawl-sunroad.mjs'

test('Sugiyama uses explicit DMS location, rejects map centers, and excludes dispensing-only',()=>{
  const label='35°07\'06.7"N 136°58\'19.3"E'
  const map=`<iframe src="https://www.google.com/maps/embed?pb=!2d140!3d40!2z${Buffer.from(label).toString('base64url')}!5e0">`
  assert(Math.abs(parseCoordinateLabel(map).lat-35.1185277778)<1e-9)
  assert.throws(()=>parseCoordinateLabel('<iframe src="https://www.google.com/maps/embed?pb=!2d140!3d40">'),/viewport/)
  const html=`<main><span class="layTxtC">ドラッグスギヤマ</span><h1>テスト店</h1><tr><th>住所</th><td>〒468-0056 名古屋市天白区島田1</td></tr>${map}</main>`
  const url='https://sugiyama-club.jp/shop/aichi/nagoya/test/seq-1.html'
  assert.equal(parseSugiyama(html,url,'2026-09-13').store.address,'愛知県名古屋市天白区島田1')
  assert(parseSugiyama(html.replace('ドラッグスギヤマ','スギヤマ調剤薬局'),url).excluded)
  assert.equal(parseSugiyama(html.replace('</main>','<dt>店舗営業時間</dt><dd>近日オープン！</dd></main>'),url).excluded.reason,'Not yet open')
  assert(parseSugiyama(html.replace('</main>','定休日は休業</main>'),url).store)
})
test('Sunroad accepts retail section rows only and preserves missing coordinates',()=>{
  const row='<div class="twelfth_child">田富店</div><div class="thirteenth_child"><a>055-273-1536</a></div><div class="fourteenth_child">〒409-3843 山梨県中央市西花輪4521-1</div><div class="fifteenth_child">9:00-21:45</div>'
  const rows=parseSunroad(row+'<h1 id="p2">ドラッグストア</h1>'+row+`<!--${row}-->`+'<h1 id="p3">'+row,'2026-09-13')
  assert.equal(rows.length,1)
  assert.equal(rows[0].lat,null)
  assert.equal(rows[0].address,'山梨県中央市西花輪4521-1')
})
