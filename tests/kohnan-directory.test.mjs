import test from 'node:test'
import assert from 'node:assert/strict'
import {parseKohnanDirectory,parseKohnanDetail} from '../scripts/crawl-kohnan.mjs'

test('Kohnan checks directory completeness and exact medicine branch identity across independent detail fields',()=>{
  const raw={id:301,store_code:'301',store_name:'コーナン 川崎小向店',phone:'044-540-1570',hpStoreType:'コーナン',hpFacilities:['薬店'],
    open_info:'{"status":"OPEN"}',address:{administrativeArea:'神奈川県',addressLines:['川崎市幸区小向西町2丁目4番地']},
    coors:{latitude:35.546981,longitude:139.6920569},hpNotices:[]}
  const directory=`1件を表示中<div data-store="${JSON.stringify(raw).replaceAll('"','&quot;')}"></div>`
  assert.equal(parseKohnanDirectory(directory).length,1)
  assert.throws(()=>parseKohnanDirectory(directory.replace('1件','2件')),/Incomplete/)
  assert.throws(()=>parseKohnanDirectory(directory.replace('1件','2件')+directory),/Duplicate/)
  const url='https://map.hc-kohnan.com/shop/301',schema={'@type':'LocalBusiness','@id':url,name:raw.store_name,telephone:raw.phone,
    address:{addressRegion:'神奈川県',addressLocality:'川崎市幸区',streetAddress:'小向西町2丁目4番地'},geo:raw.coors}
  const html=s=>`<script type="application/ld+json">${JSON.stringify(s)}</script>`
  const parse=(r=raw,s=schema)=>parseKohnanDetail(html(s),r,url,'2026-10-13T00:00:00Z','https://map.hc-kohnan.com/')
  assert.equal(parse().id,'kohnan-otc-301')
  assert.throws(()=>parse({...raw,hpFacilities:[]}))
  assert.throws(()=>parse({...raw,open_info:'{"status":"CLOSED"}'}))
  assert.throws(()=>parse(raw,{...schema,telephone:'different'}))
  assert.throws(()=>parse(raw,{...schema,geo:{latitude:35,longitude:139}}))
})
