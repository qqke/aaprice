import test from 'node:test'
import assert from 'node:assert/strict'
import {buildSourceInventory} from '../scripts/export-store-source-inventory.mjs'

test('source inventory retains unverified shops without inventing positions or operating status',()=>{
  const now=Date.parse('2026-10-12T13:00:00Z'),store={id:'s1',name:'薬店',address:'東京都新宿区1-1',sourceUrl:'https://example.com/1',collectedAt:'2026-10-12T12:00:00Z',lat:35.7,lng:139.7}
  const pending={...store,id:'s2',phone:'=WEBSERVICE("https://example.com")'}
  const result=buildSourceInventory([{file:'stores.json',rows:[store]},{file:'pending.json',rows:[pending,{...store,collectedAt:'2026-10-01T12:00:00Z'}]},{file:'confirmed-closed.json',rows:[{...store,id:'s3',closedOn:'2026-10-06'}]}],now)
  assert.equal(result.rows.length,3);assert.equal(result.skipped,1)
  assert.equal(result.rows.find(r=>r.id==='s1').state,'位置已核验')
  assert.equal(result.rows.find(r=>r.id==='s2').lat,'');assert.equal(result.rows.find(r=>r.id==='s2').state,'待核记录')
  assert.equal(result.rows.find(r=>r.id==='s3').state,'已确认闭店');assert.match(result.csv,/'=WEBSERVICE/)
  assert.equal(buildSourceInventory([{file:'stores.json',rows:[store,store]}],now).rows.length,1)
  assert.equal(buildSourceInventory([{file:'pending.json',rows:[{...store,address:'?山口県周南市1-1',pref:'?山口県'}]}],now).rows[0].pref,'山口県')
  assert.equal(buildSourceInventory([{file:'pending.json',rows:[{...store,pref:'架空県'}]}],now).rows[0].pref,'東京都')
  assert.equal(buildSourceInventory([{file:'stores.json',rows:[{...store,coordinateAccuracy:'map-center'}]}],now).rows[0].lat,'')
  assert.throws(()=>buildSourceInventory([{file:'stores.json',rows:[{...store,lat:0}]}],now),/coordinates/)
})
