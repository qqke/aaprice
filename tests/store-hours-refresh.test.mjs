import test from 'node:test'
import assert from 'node:assert/strict'
import {planHoursRefresh} from '../scripts/refresh-store-hours.mjs'

test('hours refresh requires current evidence and unchanged branch identity; never clears or inserts stores',()=>{
  const now=Date.parse('2026-10-12T13:00:00Z')
  const store={id:'store-1',name:'店舗',chain_name:'ブランド',address:'東京都新宿区1-1',hours:'09:00–18:00',lat:35.7,lng:139.7}
  const observation={...store,hours:'09:00–20:00',sourceUrl:'https://example.com/store/1',collectedAt:'2026-10-12T12:00:00Z'}
  const [change]=planHoursRefresh([store],[observation],now)
  assert.equal(change.id,store.id);assert.equal(change.hours,observation.hours)
  assert.equal(change.expectedHoursHash.length,32);assert.equal('lat' in change,false)
  for(const patch of [{id:'new'},{address:'東京都新宿区2-2'},{name:'別店舗'},{hours:''},{hours:'祝 未公布'},{hours:store.hours}])
    assert.deepEqual(planHoursRefresh([store],[{...observation,...patch}],now),[])
  assert.throws(()=>planHoursRefresh([store],[{...observation,collectedAt:'2026-10-10T12:00:00Z'}],now),/24 hours/)
  assert.throws(()=>planHoursRefresh([store],[{...observation,collectedAt:'2026-10-13T12:00:00Z'}],now),/24 hours/)
  assert.throws(()=>planHoursRefresh([store],[observation,{...observation,hours:'conflict'}],now),/Conflicting/)
  assert.equal(planHoursRefresh([store],[observation,{...observation,hours:'10:00–21:00',collectedAt:'2026-10-12T12:30:00Z'}],now)[0].hours,'10:00–21:00')
})
