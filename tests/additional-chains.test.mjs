import test from 'node:test'
import assert from 'node:assert/strict'
import {parseBuildingMarker,parseNishimoto,parseHikari,parseMarutoList} from '../scripts/crawl-additional-chains.mjs'

test('building marker rejects mall, mismatched feature ID and different street number',()=>{
 const url='https://www.google.com/maps/embed?pb=!1s0x12:0x34'
 const html=`initEmbed(${JSON.stringify([[["0x12:0x34","〒860-0845 熊本県熊本市中央区上通町２−７",[32.8,130.7]],"address",null,"建造物"]])});`
 const row={address:'熊本県熊本市中央区上通町2番7号'}
 assert.equal(parseBuildingMarker(html,url,row).lng,130.7)
 assert.throws(()=>parseBuildingMarker(html,url,{address:'熊本県熊本市中央区上通町2番8号'}))
 assert.throws(()=>parseBuildingMarker(html.replace('建造物','ショッピング モール'),url,row))
 assert.throws(()=>parseBuildingMarker(html,url.replace('0x34','0x35'),row))
})
test('named MapPress point is used instead of viewport',()=>{
 const rows=parseNishimoto("地域密着型ドラッグストア <poi title='西本真生堂 A店' address='日本、〒861-0000 熊本県熊本市一丁目1' point='32.1,130.2' viewport='30,130,35,140'></poi><poi title='cosmetics' point='32,130' address='熊本県熊本市'></poi>",'https://example.test','today')
 assert.equal(rows[0].lat,32.1);assert.equal(rows[1].retail,false)
})
test('responsive copies do not duplicate Hikari stores or import stale KML branches',()=>{
 const block='<div id="tenpowaku"><div class="xxlarge bold">A店</div>医薬品<div>住所：〒600-0000<br>京都府京都市北区1</div><div>TEL:075-123-4567</div>'
 const kml='<Placemark><name>ドラッグひかり A店</name><Point><coordinates>135.7,35.1,0</coordinates></Point></Placemark><Placemark><name>古い店</name><Point><coordinates>135,35,0</coordinates></Point></Placemark>'
 const rows=parseHikari(block+block,kml,'http://drug-hikari.co.jp/tenpo/','today')
 assert.equal(rows.length,1);assert.equal(rows[0].lat,35.1)
})
test('Maruto rejects dispensing sections and explicitly closed retail branches',()=>{
 const table=name=>`<tr><td class="shop-name"><a href="https://drug-maruto.jp/shopinfo/${name}">${name}</a></td></tr>`
 const rows=parseMarutoList(`<h4>調剤薬局</h4>${table('調剤')}<h4>県内ドラッグストア</h4>${table('A店')}${table('（閉店）B店')}`)
 assert.equal(rows.length,2);assert.equal(rows[0].retail,true);assert.equal(rows[1].retail,false)
})
