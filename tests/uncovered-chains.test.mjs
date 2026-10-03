import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {parseNara,parseMiz,parseHanshin} from '../scripts/crawl-uncovered-chains.mjs'
import {verifyMarkerAddress} from '../scripts/official-embed-marker.mjs'

test('official regional parsers classify retail without dropping malformed identities',()=>{
 const n='<div class="shbox cf"><h4>大和高田店<a name="t05">&nbsp;</a></h4><dt>住所</dt><dd>〒635-0074 大和高田市市場796-2</dd><dt>TEL＆FAX</dt><dd>0745-25-3347</dd><dt>営業時間</dt><dd>24時間営業</dd><!-- InstanceEndEditable -->'
 assert.equal(parseNara(n)[0].address,'奈良県大和高田市市場796-2')
 const h='<meta property="og:title" content="本町中央店 | 株式会社阪神薬局"><tr><th><strong>所在地</strong></th><td>〒541-0052 大阪市中央区安土町3丁目2番2号</td></tr><tr><th>連絡先</th><td>Tel06-6262-0646</td></tr><tr><th>取扱商品</th><td>保険調剤薬局、薬品類、化粧品類</td></tr>'
 const row=parseHanshin(h,'https://www.hanshin-yakkyoku.co.jp/shop/honmachi')
 assert.equal(row.excluded,false);assert.equal(row.phone,'06-6262-0646');assert.equal(row.address,'大阪府大阪市中央区安土町3丁目2番2号')
 assert.equal(parseHanshin(h.replace('保険調剤薬局、薬品類、化粧品類','保険調剤薬局'),'https://www.hanshin-yakkyoku.co.jp/shop/honmachi').excluded,true)
 const m='<li><div class="tenpoIchiran"><span class="tenpoName"><a href="https://www.miz-pharmacy.co.jp/store/119.html">溝上薬局 空港通り店</a></span><span class="catTenpo drugstore">ドラッグストア</span><tr><th>住所</th><td>佐賀市本庄町袋288-1</td></tr><tr><th>電話番号</th><td>0952-28-1513</td></tr></div></li>'
 assert.equal(parseMiz(m)[0].excluded,false);assert.equal(parseMiz(m.replace('catTenpo drugstore','catTenpo cyozai'))[0].excluded,true)
})

test('accepted crawl artifacts contain only verified coordinates and unique identities',async()=>{
 const base='artifacts/drugstores-uncovered-chains-2026-10-03',rows=JSON.parse(await readFile(`${base}/stores.json`,'utf8'))
 assert(rows.length>0);assert.equal(new Set(rows.map(s=>s.id)).size,rows.length)
 let entityMarkers=0,directMarkers=0
 for(const s of rows){assert(s.name&&s.phone&&s.address&&s.pref&&s.retailEvidence);assert(s.lat>=20&&s.lat<=46&&s.lng>=122&&s.lng<=154);assert(s.coordinateSourceUrl)
  if(s.coordinateEntityAddress){verifyMarkerAddress(s,s);entityMarkers++}else{assert.match(s.coordinateEvidence,/Official store map class marker/);assert.equal(new URL(s.coordinateSourceUrl).hostname,'muragen.com');directMarkers++}
 }
 await writeFile(`${base}/coordinate-audit.json`,JSON.stringify({checked:rows.length,entityMarkers,directMarkers,invalid:0,checkedAt:new Date().toISOString()},null,2))
})
