import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'

export function parseKohnanDirectory(html) {
  const rows=[...html.matchAll(/data-store\s*=\s*"([^"]+)"/g)].map(m=>JSON.parse(m[1]
    .replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&#039;',"'")))
  const count=Number(html.match(/(\d+)件を表示中/)?.[1])
  assert(count>0,'Missing official directory count');assert.equal(rows.length,count,'Incomplete official directory')
  assert.equal(new Set(rows.map(r=>r.id)).size,count,'Duplicate branch IDs')
  for(const row of rows)assert(row.id&&row.store_name&&Array.isArray(row.hpFacilities),'Missing branch identity/facilities')
  const drugstores=rows.filter(r=>r.hpFacilities.includes('薬店'))
  assert(drugstores.every(r=>r.store_code),'Drugstore lacks detail code')
  assert.equal(new Set(drugstores.map(r=>r.store_code)).size,drugstores.length,'Duplicate drugstore codes')
  return rows
}

export function parseKohnanDetail(html,raw,url,collectedAt,sourceListUrl) {
  assert.equal(url,'https://map.hc-kohnan.com/shop/'+raw.store_code)
  assert(raw.hpFacilities.includes('薬店'),'Branch lacks official drugstore facility')
  assert.equal(JSON.parse(raw.open_info).status,'OPEN','Official current open status differs')
  const s=[...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m=>JSON.parse(m[1])).find(s=>s['@type']==='LocalBusiness'&&s['@id']===url)
  assert(s,'Missing exact official branch schema');assert.equal(s.name,raw.store_name);assert.equal(s.telephone,raw.phone)
  const address=raw.address.administrativeArea+raw.address.addressLines.join('')
  assert.equal(normalizeAddress(s.address.addressRegion+s.address.addressLocality+s.address.streetAddress),normalizeAddress(address))
  assert.equal(s.geo.latitude,raw.coors.latitude);assert.equal(s.geo.longitude,raw.coors.longitude)
  return validateStore({id:'kohnan-otc-'+raw.store_code,name:raw.store_name,chain_name:raw.hpStoreType,
    address,pref:raw.address.administrativeArea,phone:raw.phone,lat:s.geo.latitude,lng:s.geo.longitude,
    sourceUrl:url,sourceListUrl,collectedAt,retailEvidence:'Exact official branch facilities includes 薬店',
    medicineNotice:raw.hpNotices.filter(n=>n.content?.includes('医薬品')).map(n=>n.content).join(' / '),
    coordinateStatus:'verified-store-marker',coordinateSourceUrl:url,coordinateCollectedAt:collectedAt})
}

async function main() {
  const out=process.argv.find(s=>s.startsWith('--out='))?.slice(6)||'artifacts/drugstores-kohnan-refresh'
  const get=await createFetcher(out,false,process.argv.includes('--resume')),page=await get('https://map.hc-kohnan.com/')
  const directory=parseKohnanDirectory(page.html),selected=directory.filter(r=>r.hpFacilities.includes('薬店')),stores=[],pending=[]
  await writeFile(out+'/directory.json',JSON.stringify(directory,null,2))
  for(const raw of selected) {
    const url='https://map.hc-kohnan.com/shop/'+raw.store_code
    try {const p=await get(url);stores.push(parseKohnanDetail(p.html,raw,url,p.collectedAt,page.url))}
    catch(error){pending.push({id:'kohnan-otc-'+raw.store_code,name:raw.store_name,
      address:raw.address.administrativeArea+raw.address.addressLines.join(''),chain_name:raw.hpStoreType,
      sourceUrl:url,sourceListUrl:page.url,collectedAt:page.collectedAt,reason:error.message})}
    // shortcut: separate PRO IDs may share a medicine counter; resolve identity before any import.
    await writeFile(out+'/stores.json',JSON.stringify(stores,null,2));await writeFile(out+'/pending.json',JSON.stringify(pending,null,2))
    console.log(JSON.stringify({processed:stores.length+pending.length,total:selected.length,accepted:stores.length}))
  }
  await writeFile(out+'/report.json',JSON.stringify({generatedAt:new Date().toISOString(),source:page.url,
    officialBranches:directory.length,drugstoreFacilities:selected.length,accepted:stores.length,pending:pending.length,
    identityReviewRequired:true,applied:false,nationalComplete:false},null,2))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1})
