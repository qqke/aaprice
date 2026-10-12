import assert from 'node:assert/strict'
import {parseSundrugDirectory} from './crawl-sundrug-directory.mjs'

const row={id:123,name:'検証店',country:{name:'日本'},website:' \thttps://sundrug-online.com/blogs/search-store/123\n',
  region:{name:'東京都'},city:{name:'府中市'},address_line_1:'若松町1-38-1',lat:35.67,lng:139.5,
  tags:[{title:'食品'}],opening_hours:[{day:'Monday',status:'open',opening_time:'2026-10-13T09:00:00',closing_time:'2026-10-13T21:00:00'}]}
const parsed=parseSundrugDirectory(row,'2026-10-13T00:00:00Z')
assert.equal(parsed.id,'sundrug-123')
assert.equal(parsed.sourceUrl,row.website.trim())
assert.equal(parsed.sourceWebsiteRaw,row.website)
assert.equal(row.website.startsWith(' '),true)
for(const website of ['https://example.com/blogs/search-store/123','https://sundrug-online.com.evil.test/blogs/search-store/123','https://sundrug-online.com/blogs/search-store/12 3',null])
  assert.throws(()=>parseSundrugDirectory({...row,website},''),/Unexpected official store URL/)
assert.throws(()=>parseSundrugDirectory({...row,name:'検証薬局'},''),/Dispensing/)
assert.throws(()=>parseSundrugDirectory({...row,name:'検証店(閉店)'},''),/Closure/)
console.log('Sundrug URL whitespace and rejection checks passed')
