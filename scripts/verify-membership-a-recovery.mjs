import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {parseAxis} from './crawl-membership-retail-a.mjs'
import {parseOfficialFeatureMarker,parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-membership-a-recovery-2026-10-03',old='artifacts/drugstores-membership-retail-a-2026-10-03',stores=JSON.parse(await readFile(out+'/stores.json','utf8')),audit=[]
const cache=url=>readFile(out+'/cache/'+createHash('sha256').update(url).digest('hex')+'.json','utf8').then(JSON.parse)
const text=h=>h.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().normalize('NFKC')
for(const row of stores){
 const detail=await cache(row.sourceUrl);assert.equal(detail.status,200)
 if(row.chain_name==='青葉堂グループ'){
  const address=text(detail.html.match(/<div class="address bold">([\s\S]*?)<\/div>/)?.[1]||'').replace(/^〒\d{3}-\d{4}\s*/,'')
  const phone=text(detail.html.match(/<div class="tel">([\s\S]*?)<\/div>/)?.[1]||'').replace(/^TEL\s*/,'')
  assert.equal(phone,row.phone);assert(normalizeAddress(row.address).endsWith(normalizeAddress(address)),'Detail street differs')
  assert(/class="status-icon on"[^>]*>\s*<img[^>]+alt="要指導医薬品販売"/.test(detail.html),'Exact branch enabled OTC icon absent')
 }else{const parsed=parseAxis(detail.html,row.sourceUrl);assert.equal(parsed.address,row.address);assert.equal(parsed.phone,row.phone);assert.equal(parsed.name,row.name)}
 let payload
 try{payload=await cache(row.coordinateSourceUrl)}catch{payload=JSON.parse(await readFile(old+'/cache/marker-'+createHash('sha256').update(row.coordinateSourceUrl).digest('hex')+'.json','utf8'))}
 let marker
 if(row.officialSelectedFeatureUrl){assert(detail.html.includes(row.officialSelectedFeatureUrl.replaceAll('&','&amp;'))||detail.html.includes(row.officialSelectedFeatureUrl));const selected=await cache(row.officialSelectedFeatureUrl);const feature=decodeURIComponent(selected.resolvedUrl||selected.url).match(/(?:!1s|ftid=)(0x[\da-f]+:0x[\da-f]+)/i)?.[1];assert(feature);assert.equal(feature,row.coordinateEntityId);marker=parseOfficialFeatureMarker(payload.html,'https://www.google.com/maps/embed?pb=!1s'+feature,{...row,name:row.coordinateNameAlias,address:normalizeAddress(row.address)})}
 else{marker=parseOfficialEmbedMarker(payload.html,row);verifyMarkerAddress(marker,{...row,address:normalizeAddress(row.address)})}
 assert.equal(marker.lat,row.lat);assert.equal(marker.lng,row.lng);validateStore(row);audit.push({id:row.id,primaryAddressPhoneReparsed:true,officialSelectedFeature:row.officialSelectedFeatureUrl||null,entityId:marker.coordinateEntityId,exactStreet:true})
}
await writeFile(out+'/verification.json',JSON.stringify({generatedAt:new Date().toISOString(),checked:audit.length,passed:true,audit},null,2));console.log('Verified '+audit.length+' source identities and strict entity markers')
