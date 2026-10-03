import test from 'node:test'
import assert from 'node:assert/strict'
import {parseKyushinTables,parseOkinawaPermitRows} from '../scripts/crawl-kyushu-license-registry.mjs'
test('Kyushu primary retailer tables keep branch, street, telephone and source identity',()=>{
 const table=(name,phone)=>`<table id='table-01'><th class='tenmei1'>${name}</th><a href='storedata.html?code=12345'>店舗情報</a><td>〒901-2133<br>沖縄県浦添市城間３丁目１１－１</td><td>${phone}</td><td>10:00〜21:00</td><td>日曜・祝日</td></table>`
 const rows=parseKyushinTables(table('城間薬房','098-877-5894')+table('電話なし',''))
 assert.equal(rows.length,1)
 assert.equal(rows[0].name,'城間薬房')
 assert.equal(rows[0].address,'沖縄県浦添市城間3丁目11-1')
 assert.equal(rows[0].phone,'098-877-5894')
 assert.equal(rows[0].sourceUrl,'https://www.kyushin.co.jp/shoplists/storedata.html?code=12345')
 assert.equal(rows[0].hours,'10:00〜21:00')
})

test('Historical Okinawa permits keep snapshot date, scope and missing phones explicit',()=>{
 const rows=parseOkinawaPermitRows([['許可番号','施設_名称'],['0500000020','うさぎ薬品','沖縄県南城市佐敷字津波古1060番地','','R 4. 6.30','holder'],['5/5']])
 assert.equal(rows.length,1)
 assert.equal(rows[0].asOf,'2021-08-31')
 assert.equal(rows[0].scope,'沖縄県（那覇市除外）')
 assert.equal(rows[0].phone,'')
 assert.equal(rows[0].licenseExpiry,'R 4. 6.30')
 assert.throws(()=>parseOkinawaPermitRows([['0500000020','name','鹿児島県test']]),/outside Okinawa/)
})
