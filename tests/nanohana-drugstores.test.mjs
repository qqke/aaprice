import test from 'node:test'
import assert from 'node:assert/strict'
import {parseNanohanaDrugstores} from '../scripts/crawl-nanohana-drugstores.mjs'
test('official drugstore parser excludes commented stores and retains retail identity without invented coordinates',()=>{
 const cell=(name)=>'<div class="drugstore-shop_cell-title">'+name+'</div><div class="drugstore-shop_cell-text">株式会社東北<br>福島県いわき市平字田町38-16<br>TEL：0246-85-0682<br>営業時間：9:00～20:00<br>駐車場：なし</div>'
 const rows=parseNanohanaDrugstores('<!--'+cell('閉店')+'-->'+cell('なの花ドラッグいわき')+'<div>調剤薬局一覧</div>','https://www.nanohana-ph.jp/drugstore.php','2026-10-03')
 assert.equal(rows.length,1);assert.equal(rows[0].phone,'0246-85-0682');assert.equal(rows[0].address,'福島県いわき市平字田町38-16');assert.equal(rows[0].hours,'9:00~20:00');assert.equal(rows[0].lat,undefined);assert.equal(rows[0].chain_name,'なの花ドラッグ')
})
