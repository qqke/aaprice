import test from 'node:test'
import assert from 'node:assert/strict'
import {parseRyuseidoIndex,parseRyuseidoDetails} from '../scripts/crawl-ryuseido.mjs'
test('Ryuseido follows prefecture headings and extracts detail hours',()=>{
  const row='<tr><td><a href="08.html">新宿店</a></td><td>新宿区新宿3-21-6</td><td>03-3356-3013</td></tr>'
  const rows=parseRyuseidoIndex('<tr><td>ー 東京都 ー</td></tr>'+row+`<!--${row}-->`,'2026-09-13')
  assert.equal(rows.length,1)
  assert.equal(rows[0].address,'東京都新宿区新宿3-21-6')
  assert.throws(()=>parseRyuseidoIndex(row),/Invalid/)
  assert.equal(parseRyuseidoDetails('<tr><td> 住所 </td><td>新宿区新宿3-21-6</td></tr><tr><td>営業時間</td><td>9:30<br>21:00</td></tr>').hours,'9:30 21:00')
})
