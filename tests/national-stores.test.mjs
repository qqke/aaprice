import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCanlyStore, parseSugiStore, parseMatsukiyoDirectory, parseTsuruhaEntity, parseDaikokuData, parseDaikokuStore, validateStore } from '../scripts/crawl-national-stores.mjs'

test('national directory excludes dispensing-only, future and invalid physical locations', () => {
  const time='2026-09-12T00:00:00Z'
  const canly={storeCode:'1',nameKanji:'サツドラ 店',address:'北海道札幌市',latitude:'43',longitude:'141',openStatus:'IS_ALREADY_OPEN',checkBoxLabel:{checkBoxLabel:{items:[{label:'ドラッグストア',checked:true},{label:'免税対応店',checked:false}]}}}
  assert.equal(parseCanlyStore('satudora',canly,time).taxFree,false)
  assert.throws(()=>parseCanlyStore('satudora',{...canly,checkBoxLabel:null},time),/drugstore/)
  assert.throws(()=>parseSugiStore({storeInfo:[{storeType:'pharmacy'}]},time,''),/Dispensing/)
  assert.throws(()=>validateStore({id:'bad',name:'bad',address:'東京都',lat:0,lng:0}),/coordinates/)
  assert.throws(()=>parseTsuruhaEntity({closed:false,c_sf_storeType:'PHARMACY'},time),/dispensing/)
  const m={id:1,name:'店舗',address:'東京都新宿区',latitude:35.7,longitude:139.7,icon:1,services:'0001',store_open_time_mon:'09:00:00',store_close_time_mon:'21:00:00'}
  const attrs={icon:[[1,'マツモトキヨシ']],services:[[4,'免税対応']]}
  assert.equal(parseMatsukiyoDirectory(m,attrs,time).taxFree,true)
  assert.throws(()=>parseMatsukiyoDirectory({...m,publish_start:'2027-01-01 00:00'},attrs,time),/publication/)
  assert.throws(()=>parseMatsukiyoDirectory({...m,store_open_time_mon:null},attrs,time),/retail hours/)
})

test('Daikoku data is parsed as data, never executed, and future/closed dates are excluded',()=>{
  assert.deepEqual(parseDaikokuData(`const e=JSON.parse('[{"id":"1","memo":"line\\\\nnext"}]');export{e as default};`),[{id:'1',memo:'line\nnext'}])
  assert.throws(()=>parseDaikokuData('process.exit(0)'),/Unrecognized/)
  assert.throws(()=>parseDaikokuStore({o_date:'2027-01-01',c_date:'9999-12-31'},'2026-09-12T00:00:00Z'),/active/)
})
