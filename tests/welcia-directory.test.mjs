import test from 'node:test'
import assert from 'node:assert/strict'
import {parseWelciaRetail} from '../scripts/crawl-welcia-directory.mjs'

test('Welcia nationwide import accepts explicit retail and excludes pharmacies or unlisted locations',()=>{
  const row={code:'123D',name:'ウエルシアテスト店',status:'normal',address_name:'東京都新宿区1-2',coord:{lat:35.7,lon:139.7},categories:[{name:'ウエルシア'}],
    detail_groups:[{texts:[{details:[{code:'00002',value:'ドラッグストア'},{code:'00007',value:'09:00–22:00'}]}],flags:[{details:[{code:'00258',value:true}]}]}]}
  const parsed=parseWelciaRetail(row,'2026-10-03T00:00:00Z')
  assert.equal(parsed.coordinateDatum,'wgs84')
  assert.equal(parsed.hours,'09:00–22:00')
  assert.throws(()=>parseWelciaRetail({...row,detail_groups:[{texts:[{details:[{code:'00002',value:'薬局'}]}]}]},''),/retail/)
  assert.throws(()=>parseWelciaRetail({...row,name:'閉店 テスト店'},''),/Closure/)
  assert.throws(()=>parseWelciaRetail({...row,detail_groups:[{texts:row.detail_groups[0].texts}]},''),/public store search/)
})
