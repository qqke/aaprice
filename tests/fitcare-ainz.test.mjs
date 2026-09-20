import test from 'node:test'
import assert from 'node:assert/strict'
import {parseFitcare,parseAinz} from '../scripts/crawl-fitcare-ainz.mjs'
test('Fit Care requires retail department and an explicit map marker',()=>{
  const h='<div class="shopNameInner"><h3>テスト店</h3></div><div class="shopInfo"><li>〒123-4567</li><li>横浜市港北区1</li></div><h4>ドラッグストア</h4><ul><li>【営業時間】9:00-21:00</li></ul>var latlng=new google.maps.LatLng(35.5,139.6); var markerOptions={position:latlng};new google.maps.Marker(markerOptions);'
  const u='https://www.kamegaya.co.jp/search/fitCareDepot/entry1.html'
  assert.equal(parseFitcare(h,u).store.address,'神奈川県横浜市港北区1')
  assert(parseFitcare(h.replace('position:latlng','position:other'),u).pending)
  assert(parseFitcare(h.replace('ドラッグストア','調剤薬局'),u).excluded)
  assert(parseFitcare(h.replace('<h4>ドラッグストア</h4>',''),u).store)
})
test('Ainz list preserves data without inventing coordinates',()=>{
  const h='<li class="wl-shop-list__item"><a href="/blogs/shop/1"><h4 class="wl-shop-list__item-title">アインズ＆トルペ テスト</h4><div class="wl-shop-list__item-data__value">東京都新宿区1</div><div class="wl-shop-list__item-data__value">03-1234-5678</div></a></li>'
  assert.equal(parseAinz(h,'2026-09-13')[0].lat,null)
})
