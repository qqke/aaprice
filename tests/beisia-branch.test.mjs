import test from 'node:test'
import assert from 'node:assert/strict'
import {parseBeisiaBranch} from '../scripts/crawl-beisia.mjs'

test('Beisia requires exact branch OTC flag and independently consistent Store identity and position',()=>{
  const point={key:'322',name:'ベイシア宇都宮陽東店',address:'栃木県宇都宮市陽東3-27-20',latitude:36.55629,longitude:139.92545,
    extra_fields:{'取扱商品_医薬品':'1','電話番号':'028-661-8111','営業時間':'9:00～21:00'}}
  const schema={'@type':'Store',name:point.name,address:{streetAddress:point.address},telephone:point.extra_fields['電話番号'],geo:{latitude:point.latitude,longitude:point.longitude}}
  const html=(p=point,s=schema)=>`<script>const storelocator = {};\nstorelocator['point']['point'] = ${JSON.stringify(p)}</script><script type="application/ld+json">${JSON.stringify(s)}</script>`
  const parse=h=>parseBeisiaBranch(h,'https://map.beisia.co.jp/points/322','2026-10-13T00:00:00Z')
  assert.equal(parse(html()).id,'beisia-otc-322')
  assert.equal(parse(html({...point,extra_fields:{...point.extra_fields,'取扱商品_医薬品':'0'}})),null)
  assert.throws(()=>parse(html({...point,key:'other'})),/identity/)
  assert.throws(()=>parse(html(point,{...schema,geo:{latitude:35,longitude:139}})))
  assert.throws(()=>parse(html(point,{...schema,address:{streetAddress:'別の住所'}})))
})
