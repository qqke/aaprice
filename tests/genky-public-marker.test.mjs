import test from 'node:test'
import assert from 'node:assert/strict'
import {parseGenkyBusinessMarker} from '../scripts/crawl-genky-public-markers.mjs'

test('Genky corporate-hotline fallback verifies business website and exact branch address',()=>{
  const row={name:'ゲンキー 天坂店',address:'石川県珠洲市天坂町85',hours:'9:00–21:00',sourceUrl:'https://www.genky.co.jp/sp/stores/cont.php'}
  const entity=[]
  entity[0]=['0xabc:0xdef','石川県珠洲市天坂町85',[37.4,137.2]]
  entity[1]='ゲンキー 天坂店';entity[13]=row.address;entity[11]=[null,'www.genky.co.jp']
  const html=e=>`initEmbed(${JSON.stringify([e])});`
  assert.equal(parseGenkyBusinessMarker(html(entity),row).lat,37.4)
  assert.throws(()=>parseGenkyBusinessMarker(html(entity),{...row,name:'ゲンキー 別店'}),/matching official website/)
  assert.throws(()=>parseGenkyBusinessMarker(html(entity),{...row,address:'石川県珠洲市天坂町86'}),/numbers differ/)
  assert.throws(()=>parseGenkyBusinessMarker(html(Object.assign([...entity],{11:[null,'example.com']})),row),/matching official website/)
})
