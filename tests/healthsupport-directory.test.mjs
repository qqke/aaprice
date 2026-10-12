import test from 'node:test'
import assert from 'node:assert/strict'
import {parseHealthsupportDirectory,naviiField} from '../scripts/crawl-tochigi-healthsupport.mjs'

test('government directory keeps published dates and identities across rowspans; never assumes a location',()=>{
  const link=code=>`<td><a href="https://www.iryou.teikyouseido.mhlw.go.jp/znk-web/juminkanja/S2430/initialize?kikanCd=${code}&amp;prefCd=09">薬局${code}</a></td><td>宇都宮市1-1</td><td>株式会社A</td>`
  const html=`健康サポート薬局2施設（令和8(2026)年3月31日現在）<table><tr><td rowspan="2">地域</td><td>市</td>${link('1')}</tr><tr>${link('2')}</tr><!-- <tr>${link('old')}</tr> --></table>`
  const rows=parseHealthsupportDirectory(html,'https://example.com','2026-10-13')
  assert.equal(rows.length,2);assert.equal(rows[0].sourceAsOf,'2026-03-31');assert.equal(rows[1].address,'栃木県宇都宮市1-1');assert.equal(rows[0].lat,undefined)
  assert.equal(parseHealthsupportDirectory(html.replace('2施設','3施設'),'https://example.com','2026-10-13')[0].directoryCountMismatch,true)
  assert.throws(()=>parseHealthsupportDirectory(html.replace('<table>','<table><tr><td><a href="https://www.iryou.teikyouseido.mhlw.go.jp/znk-web/juminkanja/S2430/initialize?kikanCd=bad">bad</a></td></tr>'),'https://example.com','2026-10-13'),/Incomplete/)
  assert.equal(naviiField('<tr><th><label class="ptn1ItemName">営業日の開店時間内電話番号</label></th><td>(0287)486138</td></tr>','営業日の開店時間内電話番号'),'(0287)486138')
})
