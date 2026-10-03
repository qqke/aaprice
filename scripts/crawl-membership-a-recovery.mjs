import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {databaseProcess} from './sync-sundrug.mjs'
import {parseOfficialEmbedMarker,parseOfficialFeatureMarker,parseWebsiteVerifiedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-membership-a-recovery-2026-10-03',old='artifacts/drugstores-membership-retail-a-2026-10-03'
await mkdir(out+'/cache',{recursive:true})
async function get(url){const file=out+'/cache/'+createHash('sha256').update(url).digest('hex')+'.json';try{return JSON.parse(await readFile(file,'utf8'))}catch{}const r=await fetch(url,{signal:AbortSignal.timeout(25000)}),p={url,resolvedUrl:r.url,status:r.status,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(p));if(!r.ok)throw Error('HTTP '+r.status);return p}
const input=JSON.parse(await readFile(old+'/pending.json','utf8')).filter(x=>x.status==='pending-marker'),details=[]
for(let i=0;i<input.length;i+=4)await Promise.all(input.slice(i,i+4).map(async row=>{try{const p=await get(row.sourceUrl);details.push({...row,detailCollectedAt:p.collectedAt,mapUrls:[...p.html.matchAll(/(?:src|href)=["']([^"']*(?:google[^"']*maps|maps[^"']*google)[^"']*)["']/g)].map(x=>x[1].replace(/&amp;|&#038;?/g,'&'))})}catch(e){details.push({...row,detailError:e.message})}}))
for(const row of details){if(row.detailError)continue;const p=await get(row.sourceUrl);row.mapUrls=[...new Set([...row.mapUrls,...[...p.html.matchAll(/href=["'](https?:\/\/[^"']*(?:maps\.app\.goo\.gl|goo\.gl\/maps)[^"']*)["']/g)].map(x=>x[1].replace(/&amp;|&#038;?/g,'&'))])];row.selectedMaps=[];for(const url of row.mapUrls){try{const map=await get(url);row.selectedMaps.push({url,resolvedUrl:map.resolvedUrl||url,feature:decodeURIComponent(map.resolvedUrl||url).match(/(?:!1s|ftid=)(0x[\da-f]+:0x[\da-f]+)/i)?.[1]})}catch(e){row.selectedMaps.push({url,error:e.message})}}}
await writeFile(out+'/details.json',JSON.stringify(details,null,2))
const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(s) from(select id,name,chain_name,address,pref,lat,lng from stores)s;"),db=JSON.parse(raw.slice(raw.indexOf('['))),stores=[],pending=[],audit=[]
const near=(a,b)=>Math.hypot((a.lat-b.lat)*111320,(a.lng-b.lng)*111320*Math.cos(a.lat*Math.PI/180))<60
for(const row of details){
 if(db.some(d=>d.id===row.id)){audit.push({id:row.id,status:'already-existing'});continue}
 try{
  if(row.detailError)throw Error(row.detailError)
  const primary=await get(row.sourceUrl),plain=primary.html.replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,' ').normalize('NFKC').replace(/\s/g,'')
  if(!plain.includes(row.phone.replaceAll('-',''))) {if(!plain.includes(row.phone))throw Error('Primary detail does not independently confirm official phone')}
  const originalQuery='https://www.google.com/maps?q='+encodeURIComponent(row.name+' '+row.address)+'&output=embed&hl=ja',original=JSON.parse(await readFile(old+'/cache/marker-'+createHash('sha256').update(originalQuery).digest('hex')+'.json','utf8'))
  let marker,markerUrl=originalQuery,lastError
  for(const name of [row.name,row.name.replaceAll('・','').replace(/[（(][^）)]*[）)]/g,'')]){try{marker=parseOfficialEmbedMarker(original.html,{...row,name});verifyMarkerAddress(marker,{...row,address:normalizeAddress(row.address)});break}catch(e){lastError=e;marker=null}}
  if(!marker)for(const map of row.selectedMaps||[]){if(!map.feature)continue;const place=decodeURIComponent(map.resolvedUrl).match(/\/place\/([^/]+)/)?.[1]?.replaceAll('+',' ')||row.name,name=/〒/.test(place)?row.name:place
   try{marker=parseOfficialFeatureMarker(original.html,'https://www.google.com/maps/embed?pb=!1s'+map.feature,{...row,name,address:normalizeAddress(row.address)});markerUrl=originalQuery;row.officialSelectedFeatureUrl=map.url;row.officialSelectedFeatureResolvedUrl=map.resolvedUrl;row.coordinateNameAlias=name;break}catch(e){lastError=e;marker=null}
   try{const url='https://www.google.com/maps?q='+encodeURIComponent(name)+'&ftid='+encodeURIComponent(map.feature)+'&output=embed&hl=ja',p=await get(url);marker=parseOfficialFeatureMarker(p.html,'https://www.google.com/maps/embed?pb=!1s'+map.feature,{...row,name,address:normalizeAddress(row.address)});markerUrl=url;row.officialSelectedFeatureUrl=map.url;row.officialSelectedFeatureResolvedUrl=map.resolvedUrl;row.coordinateNameAlias=name;break}catch(e){lastError=e;marker=null}
  }
  if(!marker)throw lastError||Error('No exact official selected feature verified')
  const nearby=db.filter(s=>near(marker,s));if(nearby.length)throw Error('Nearby existing identity review: '+nearby.map(s=>s.id).join(','))
  if(stores.some(s=>near(marker,s)))throw Error('Nearby staged entity review')
  const safe={...row,...marker,coordinateSourceUrl:markerUrl,coordinateCollectedAt:new Date().toISOString()};delete safe.reason;delete safe.status;delete safe.matchedIds;stores.push(validateStore(safe));audit.push({id:row.id,sourceUrl:row.sourceUrl,primaryPhoneReparsed:true,streetNumbersExact:true,selectedFeature:row.officialSelectedFeatureUrl||null,entity:marker.coordinateEntityId,status:'accepted'})
 }catch(e){pending.push({...row,recoveryReason:e.message.split('\n')[0]});audit.push({id:row.id,status:'pending',reason:e.message.split('\n')[0]})}
}
for(const[key,value]of Object.entries({stores,pending,audit}))await writeFile(out+'/'+key+'.json',JSON.stringify(value,null,2))
const report={generatedAt:new Date().toISOString(),databaseRows:db.length,input:input.length,accepted:stores.length,pending:pending.length,existing:audit.filter(x=>x.status==='already-existing').length,nationalComplete:false};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
