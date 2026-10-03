import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCentralLicenseRows} from '../scripts/crawl-central-license-registry.mjs'
test('Central government license columns preserve expiry, owner and missing telephone without inventing coordinates',()=>{
 const source={id:'toyama-pref-legacy',asOf:'2026-04-01',url:'https://government.example/list.xlsx'}
 const rows=parseCentralLicenseRows(source,[['許可番号'],['高店1','2025-01-01','2031-01-01','薬店','高岡市1-2-3','開設者']])
 assert.equal(rows.length,1);assert.equal(rows[0].address,'富山県高岡市1-2-3');assert.equal(rows[0].licenseExpiry,'2031-01-01');assert.equal(rows[0].licenseHolder,'開設者');assert.equal(rows[0].phone,'');assert.equal(rows[0].lat,undefined)
 const s=parseCentralLicenseRows({...source,id:'shizuoka-pref'},[['番号'],[1,'許可2','薬舗','静岡県沼津市1-2-3','2025-01-01','2031-01-01','055-123-4567']])[0]
 assert.equal(parseCentralLicenseRows({...source,id:'shizuoka-pref'},[['番号'],[1,'許可3','薬店','御殿場市新橋1-2']])[0].address,'静岡県御殿場市新橋1-2');
 assert.equal(s.phone,'055-123-4567');assert.equal(s.licenseNumber,'許可2')
 assert.throws(()=>parseCentralLicenseRows({...source,id:'shizuoka-pref'},[['番号'],[1,'許可2','薬舗','京都府京都市1-2-3']]),/outside/)
})
