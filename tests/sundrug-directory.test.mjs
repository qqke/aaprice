import test from 'node:test'
import assert from 'node:assert/strict'
import {parseSundrugDirectory} from '../scripts/crawl-sundrug-directory.mjs'
test('Sundrug directory excludes departments and future stores, uses explicit coordinates',()=>{
  const row={id:1,name:'扶桑店',country:{name:'日本'},region:{name:'愛知県'},city:{name:'丹羽郡'},address_line_1:'扶桑町7',website:'https://sundrug-online.com/blogs/search-store/3037',lat:35.36,lng:136.92,tags:[{title:'食品'}],opening_hours:[{day:'Monday',status:'open',opening_time:'2026-09-13T09:30:00+09:00',closing_time:'2026-09-13T21:00:00+09:00'}]}
  assert.equal(parseSundrugDirectory(row,'2026-09-13').address,'愛知県丹羽郡扶桑町7')
  assert.throws(()=>parseSundrugDirectory({...row,name:'扶桑薬局'}),/Dispensing/)
  assert.throws(()=>parseSundrugDirectory({...row,name:'扶桑店 オープン予定'}),/future/)
  assert.throws(()=>parseSundrugDirectory({...row,name:'宇土店(地震の影響により営業を中止しております)'}),/Closure/)
  assert.throws(()=>parseSundrugDirectory({...row,lat:null}),/coordinates/)
})
