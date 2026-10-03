import test from 'node:test'
import assert from 'node:assert/strict'
import {parseOsdrugDirectory} from '../scripts/crawl-osdrug.mjs'
const table=(name,content)=>'<TABLE width="503"><TD><FONT color="#003300">'+name+'</FONT></TD><TD>'+content+'</TD></TABLE>'
test('OS Drug legacy directory normalizes Japanese full-width phone and retains incomplete branches',()=>{
 const html=table('本 社','東大阪市吉田4-7-13 Tel.072-963-2901')+table('新 千 林 店','大阪市旭区千林2-11-30 Ｔel. ０６－６９５２－８４２８ 営業時間 9：00～18:45 大阪メトロ谷町線')+table('名 谷 店','')
 const result=parseOsdrugDirectory(html,'2026-10-03')
 assert.equal(result.excluded.length,1)
 assert.equal(result.rows.length,2)
 assert.equal(result.rows[0].phone,'06-6952-8428')
 assert.equal(result.rows[0].address,'大阪市旭区千林2-11-30')
 assert.equal(result.rows[1].address,'')
 assert.notEqual(result.rows[0].id,result.rows[1].id)
 assert.throws(()=>parseOsdrugDirectory(table('庄 内 店','豊中市 Tel.06-6331-5646 営業時間 9:00')+table('庄 内 店','豊中市 Tel.06-6331-5646 営業時間 9:00'),'2026-10-03'),/Assertion/)
})
