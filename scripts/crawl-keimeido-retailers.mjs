import {writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createFetcher,validateStore} from './crawl-national-stores.mjs'
import {databaseProcess} from './sync-sundrug.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {indexExistingBranches,possibleExistingBranches} from './drugstore-identity.mjs'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
const out=process.env.KEIMEIDO_OUT||'artifacts/drugstores-keimeido-retailers-2026-10-03'
const text=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().normalize('NFKC')
export function parseKeimeidoRetailers(html,sourceUrl,collectedAt){
 return [...html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(([,block])=>{
  const cell=key=>text(block.match(new RegExp('<td class="'+key+'">([\\s\\S]*?)<\\/td>'))?.[1]||'')
  const name=cell('shop_name'),address=cell('address'),phone=cell('phone');if(!name)return []
  const products=[...block.matchAll(/<img[^>]+src="([^"]*item[123]_(?:stock|order)\.png)"[^>]*alt="([^"]+)"/g)].map(m=>({name:text(m[2]),availability:m[1].includes('_stock')?'stock':'order'}))
  const contactIssue=!address||!phone?'Primary retailer lacks address/contact':null
  const pref=address.match(/^(東京都|北海道|大阪府|京都府|.{2,3}県)/)?.[1];
  return [{id:'keimeido-'+createHash('sha256').update(name+'|'+normalizeAddress(address)).digest('hex').slice(0,16),name,address,phone,pref,contactIssue:contactIssue||(!pref?'Primary address lacks prefecture':null),chain_name:'その他薬品販売店',products,sourceUrl,collectedAt,retailEvidence:products.length?'Exact manufacturer branch lists OTC medicine stock or order icon':'Product availability not established for exact branch'}]
 })
}
async function main(){
 await mkdir(out,{recursive:true});const get=await createFetcher(out,process.argv.includes('--offline'),true),home=await get('https://www.keimeido.co.jp/shop/kanagawa'),slugs=[...new Set([...home.html.matchAll(/href="\.\/shop\/([a-z]+)"/g)].map(m=>m[1]))];if(slugs.length!==47)throw Error('Official prefecture directory count differs from47')
 const rows=[],sources=[];for(let i=0;i<slugs.length;i+=4)await Promise.all(slugs.slice(i,i+4).map(async slug=>{const url='https://www.keimeido.co.jp/shop/'+slug;try{const p=await get(url),r=parseKeimeidoRetailers(p.html,url,p.collectedAt);rows.push(...r);sources.push({slug,url,rows:r.length,collectedAt:p.collectedAt,enumerationComplete:true})}catch(e){sources.push({slug,url,error:e.message,enumerationComplete:false})}}))
 const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect coalesce(json_agg(s),'[]'::json) from(select id,name,chain_name,address,pref,lat,lng from public.stores)s;"),db=JSON.parse(raw.slice(raw.indexOf('['))),index=indexExistingBranches(db),existingIds=new Set(db.map(d=>d.id)),addresses=new Map();for(const d of db){const a=normalizeAddress(d.address);addresses.set(a,[...(addresses.get(a)||[]),d.id])}
 const ledger=rows.map(r=>({...r,existingIds:[...(existingIds.has(r.id)?[r.id]:[]),...possibleExistingBranches(r,index)],sameAddressIds:addresses.get(normalizeAddress(r.address))||[],status:r.contactIssue?'contact-review':!r.products.length?'product-scope-review':existingIds.has(r.id)||possibleExistingBranches(r,index).length?'existing-identity-review':addresses.has(normalizeAddress(r.address))?'same-address-review':'unmatched'}));await writeFile(out+'/directory-ledger.json',JSON.stringify(ledger,null,2));await writeFile(out+'/source-index.json',JSON.stringify(sources,null,2));const report={generatedAt:new Date().toISOString(),databaseRows:db.length,sourceRows:rows.length,prefectures:slugs.length,enumerationComplete:sources.every(s=>s.enumerationComplete),states:ledger.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),nationalComplete:false,limitations:['Manufacturer customer directory is not all nationwide drugstores','No inference of closure or dispensing-only status from manufacturer absence','Existing identity and same-address rows need branch review, not automatic duplicate deletion']};await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
 if(!process.argv.includes('--verify-unmatched'))return
 const limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.slice(8)||40),selected=ledger.filter(r=>r.status==='unmatched').sort((a,b)=>a.name.localeCompare(b.name,'ja')).slice(0,limit),stores=[],pending=[];for(let i=0;i<selected.length;i+=4)await Promise.all(selected.slice(i,i+4).map(async r=>{try{const url='https://www.google.com/maps?q='+encodeURIComponent(r.name+' '+r.address)+'&output=embed&hl=ja',p=await get(url),m=parseOfficialEmbedMarker(p.html,r);verifyMarkerAddress(m,{...r,address:normalizeAddress(r.address)});const near=d=>Math.hypot((d.lat-m.lat)*111320,(d.lng-m.lng)*111320*Math.cos(m.lat*Math.PI/180))<60;if(db.some(near)||stores.some(near))throw Error('Nearby existing/staged identity review');if(/閉業|permanently closed/.test(p.html))throw Error('Possible closed marker');stores.push(validateStore({...r,...m,coordinateSourceUrl:url,coordinateCollectedAt:p.collectedAt}))}catch(e){pending.push({...r,reason:e.message})}}));await writeFile(out+'/stores.json',JSON.stringify(stores,null,2));await writeFile(out+'/pending.json',JSON.stringify(pending,null,2));console.log(JSON.stringify({selected:selected.length,accepted:stores.length,pending:pending.length}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main()
