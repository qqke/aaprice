import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {databaseProcess} from './sync-sundrug.mjs'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {parseKeimeidoRetailers} from './crawl-keimeido-retailers.mjs'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {indexExistingBranches,possibleExistingBranches} from './drugstore-identity.mjs'
const arg=(key,fallback)=>process.argv.find(s=>s.startsWith('--'+key+'='))?.slice(key.length+3)||fallback
const sourceOut=arg('source','artifacts/drugstores-keimeido-retailers-2026-10-03'),out=arg('out','artifacts/drugstores-keimeido-check-2026-10-03'),offset=Number(arg('offset','0')),limit=Number(arg('limit','100'))
assert(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0,'Invalid selected range')
await mkdir(out,{recursive:true});const input=await readFile(sourceOut+'/unmatched-frozen.json','utf8'),rows=JSON.parse(input).slice(offset,offset+limit),primary=new Map(),get=await createFetcher(out,process.argv.includes('--offline'),true)
const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from(select id,name,chain_name,address,pref,lat,lng from public.stores)s;"),db=JSON.parse(raw.slice(raw.indexOf('['))),index=indexExistingBranches(db),stores=[],attempts=[]
for(let i=0;i<rows.length;i+=4){await Promise.all(rows.slice(i,i+4).map(async row=>{try{
 const matches=[...db.filter(d=>d.id===row.id).map(d=>d.id),...possibleExistingBranches(row,index)];if(matches.length){attempts.push({id:row.id,status:'existing-review',databaseIds:matches});return}
 if(!primary.has(row.sourceUrl)){const p=JSON.parse(await readFile(sourceOut+'/cache/'+createHash('sha256').update(row.sourceUrl).digest('hex')+'.json','utf8'));primary.set(row.sourceUrl,parseKeimeidoRetailers(p.html,p.url,p.collectedAt))}
 const current=primary.get(row.sourceUrl).find(r=>r.id===row.id);assert(current&&!current.contactIssue&&current.products.length,'Primary OTC identity unavailable');for(const key of ['name','address','phone'])assert.equal(current[key],row[key],'Frozen primary identity differs')
 const url='https://www.google.com/maps?q='+encodeURIComponent(row.name+' '+row.address)+'&output=embed&hl=ja',p=await get(url),m=parseOfficialEmbedMarker(p.html,row);verifyMarkerAddress(m,{...row,address:normalizeAddress(row.address)});if(/閉業|permanently closed/.test(p.html))throw Error('Possible permanently closed business marker')
 const near=d=>Math.hypot((d.lat-m.lat)*111320,(d.lng-m.lng)*111320*Math.cos(m.lat*Math.PI/180))<60;if(db.some(near)||stores.some(near))throw Error('Nearby existing/staged identity review')
 stores.push(validateStore({...current,...m,coordinateSourceUrl:url,coordinateCollectedAt:p.collectedAt}));attempts.push({id:row.id,status:'accepted'})
 }catch(e){attempts.push({...row,status:'pending',reason:e.message.split('\n')[0]})}}));for(const [key,value]of Object.entries({stores,attempts}))await writeFile(out+'/'+key+'.json',JSON.stringify(value,null,2));console.log(JSON.stringify({processed:attempts.length,selected:rows.length,accepted:stores.length,pending:attempts.filter(r=>r.status==='pending').length}))}
await writeFile(out+'/report.json',JSON.stringify({generatedAt:new Date().toISOString(),inputSha256:createHash('sha256').update(input).digest('hex'),offset,limit,selected:rows.length,databaseRows:db.length,accepted:stores.length,states:attempts.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),nationalComplete:false,source:'Manufacturer OTC retailer directory, not nationwide licensing universe'},null,2))
