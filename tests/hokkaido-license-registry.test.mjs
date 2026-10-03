import test from 'node:test'
import assert from 'node:assert/strict'
import {parseAbashiriRows} from '../scripts/crawl-hokkaido-license-registry.mjs'
test('Abashiri licenses preserve government telephone, snapshot scope and wrapped store identity without assuming current operation',()=>{
 const source={url:'https://government.example/tenpo.pdf',asOf:'2023-12-01',scope:'網走保健所管内のみ'}
 const rows=parseAbashiriRows([['','名称','郵便番号','所在地','電話番号'],['１','ツルハドラッグ\nつくしケ丘店','093-0034','網走市つくしケ丘１丁目 90―93','0152-61-0623'],['注','脚注','','','']],source)
 assert.equal(rows.length,1);assert.equal(rows[0].name,'ツルハドラッグ つくしケ丘店');assert.equal(rows[0].address,'北海道網走市つくしケ丘1丁目90―93');assert.equal(rows[0].phone,'0152-61-0623');assert.equal(rows[0].scope,source.scope);assert.equal(rows[0].licenseOperationCurrent,false);assert.equal(rows[0].lat,undefined)
})
