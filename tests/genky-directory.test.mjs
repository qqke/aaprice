import test from 'node:test'
import assert from 'node:assert/strict'
import {parseGenkyDetail} from '../scripts/crawl-genky-directory.mjs'
test('Genky requires marker at coordinates, not only a map center',()=>{
  const html='var myLatlng=new google.maps.LatLng(36.410607, 136.467007);var marker=new google.maps.Marker({position: myLatlng,map: map,title:"ゲンキー白江店"});<h2>所在地</h2><p>石川県小松市白江町1</p><h2>営業時間</h2><p>9:00～21:00</p>'
  assert.equal(parseGenkyDetail(html,'https://www.genky.co.jp/sp/stores/cont.php?cont_no=310','2026-09-13').lat,36.410607)
  assert.throws(()=>parseGenkyDetail(html.replace('position: myLatlng','position: other'),'https://www.genky.co.jp/sp/stores/cont.php?cont_no=310'),/marker/)
})
