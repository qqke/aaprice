import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {databaseProcess} from './sync-sundrug.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {normalizeIdentityText,indexExistingBranches,possibleExistingBranches} from './drugstore-identity.mjs'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-license-central-2026-10-03'
export function parseCentralLicenseRows(source,rows){
 const toyama=source.id.startsWith('toyama'),pref=toyama?'富山県':'静岡県'
 return rows.slice(1).filter(r=>r[0]&&r[toyama?3:2]&&r[toyama?4:3]).map(r=>{
  const name=String(r[toyama?3:2]).normalize('NFKC'),rawAddress=String(r[toyama?4:3]),permit=String(r[toyama?0:1])
  const address=/^(東京都|北海道|大阪府|京都府|.{2,3}県)/.test(rawAddress)?rawAddress:pref+rawAddress
  if(!address.startsWith(pref))throw Error('License address outside source prefecture')
  return {id:'license-'+source.id+'-'+createHash('sha256').update(permit+address+name).digest('hex').slice(0,16),name,chain_name:'独立薬店',address,licenseAddressRaw:rawAddress,pref,phone:toyama?'':String(r[6]||''),licenseNumber:permit,licenseExpiry:r[toyama?2:5],licenseHolder:toyama?r[5]:'',sourceUrl:source.url,sourcePage:source.page,asOf:source.asOf,scope:source.scope}
 })
}
async function main(){
 await mkdir(out+'/cache',{recursive:true})
 const sources=JSON.parse(await readFile(out+'/source-index.json','utf8')),rows=[]
 for(const source of sources)rows.push(...parseCentralLicenseRows(source,Object.values(JSON.parse(await readFile(out+'/sources/'+source.id+'.rows.json','utf8')))[0]))
 const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(s) from(select id,name,chain_name,address,pref,lat,lng from stores)s;")
 const db=JSON.parse(raw.slice(raw.indexOf('['))),addressIndex=new Map(),nameIndex=new Map(),review=indexExistingBranches(db)
 for(const s of db)for(const [index,key]of [[addressIndex,normalizeAddress(String(s.address).replace(/^〒?\s*\d{3}-?\d{4}\s*/,''))],[nameIndex,s.pref+'|'+normalizeIdentityText(s.name)]]){if(!index.has(key))index.set(key,[]);index.get(key).push(s.id)}
 const ledger=[],candidates=[],stores=[],pending=[]
 for(const row of rows){const matches=[...new Set([...(addressIndex.get(normalizeAddress(row.address))||[]),...(nameIndex.get(row.pref+'|'+normalizeIdentityText(row.name))||[]),...possibleExistingBranches(row,review)])];row.matchedIds=matches;row.status=matches.length?'existing-or-identity-review':!/薬|ドラッグ|くすり|漢方/.test(row.name)||/通販|オンライン|ネット|製薬|本社/.test(row.name)?'format-review':/マツモトキヨシ|サンドラッグ|ツルハ|ウエルシア|ウェルシア|ココカラ|セイジョー|ドラッグスギ|スギドラッグ|スギ薬局|セイムス|アオキ|コスモス|ゲンキー|クリエイト|V.?drug|カワチ|キリン堂/i.test(row.name)?'known-brand-identity-review':!row.phone?'needs-official-phone':'candidate';ledger.push(row);if(row.status==='candidate')candidates.push(row)}
 await writeFile(out+'/license-ledger.json',JSON.stringify(ledger,null,2));await writeFile(out+'/candidates.json',JSON.stringify(candidates,null,2))
 const near=(a,b)=>Math.hypot((a.lat-b.lat)*111320,(a.lng-b.lng)*111320*Math.cos(a.lat*Math.PI/180))<60
 for(let i=0;i<candidates.length;i+=4){await Promise.all(candidates.slice(i,i+4).map(async row=>{
  const url='https://www.google.com/maps?q='+encodeURIComponent(row.name+' '+row.address)+'&output=embed&hl=ja',file=out+'/cache/'+createHash('sha256').update(url).digest('hex')+'.json'
  try{let page;try{page=JSON.parse(await readFile(file,'utf8'))}catch{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);page={url,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(page))}
   const marker=parseOfficialEmbedMarker(page.html,row);verifyMarkerAddress(marker,{...row,address:normalizeAddress(row.address)})
   if(db.some(s=>near(marker,s))||stores.some(s=>near(marker,s)))throw Error('Nearby existing/staged store requires identity review')
   stores.push(validateStore({...row,...marker,coordinateSourceUrl:url,coordinateCollectedAt:page.collectedAt,coordinateEvidence:'Government OTC store-sales permit; exact business name/phone/full street entity; existing names and nearby stores quarantined'}))
  }catch(e){pending.push({...row,reason:e.message.split('\n')[0]})}
 }));await writeFile(out+'/stores.json',JSON.stringify(stores,null,2));await writeFile(out+'/pending.json',JSON.stringify(pending,null,2))}
 const counts=sources.map(s=>({id:s.id,asOf:s.asOf,states:ledger.filter(x=>x.sourceUrl===s.url).reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{})}))
 const report={generatedAt:new Date().toISOString(),databaseRows:db.length,licenses:ledger.length,candidates:candidates.length,accepted:stores.length,pending:pending.length,counts,nationalComplete:false,sourceCoverageComplete:false,limitations:['Snapshots exclude separately licensed cities','Snapshot-to-today additions and closures unresolved','Toyama registry omits phone; current independent retailer phone required','Other central prefecture registries remain unresolved']}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main()
