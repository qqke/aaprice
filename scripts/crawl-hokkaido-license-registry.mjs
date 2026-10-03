import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {databaseProcess} from './sync-sundrug.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {indexExistingBranches,possibleExistingBranches} from './drugstore-identity.mjs'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-license-hokkaido-2026-10-03'
export function parseAbashiriRows(rows,source){
 return rows.slice(1).filter(r=>/^\d+$/.test(String(r[0]).normalize('NFKC'))).map(r=>{
 const name=r[1].replace(/\n/g,' ').normalize('NFKC'),address='北海道'+r[3].replace(/\s/g,'').normalize('NFKC')
 return {id:'license-abashiri-'+createHash('sha256').update(name+address).digest('hex').slice(0,16),name,chain_name:/ツルハ/.test(name)?'ツルハドラッグ':/サツドラ/.test(name)?'サツドラ':/コープドラッグ/.test(name)?'コープドラッグ':'独立薬店',address,pref:'北海道',phone:r[4],sourceUrl:source.url,sourcePage:source.sourcePage,licenseAsOf:source.asOf,scope:source.scope,licenseOperationCurrent:false}
 })
}
async function main(){
 const source=JSON.parse(await readFile(out+'/source-index.json','utf8'))[0],records=parseAbashiriRows(JSON.parse(await readFile(out+'/cache/abashiri.rows.json','utf8')),source)
 const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(s) from(select id,name,chain_name,address,pref,lat,lng from public.stores)s;")
 const db=JSON.parse(raw.slice(raw.indexOf('['))),index=indexExistingBranches(db),stores=[],pending=[]
 const official=await readFile(out+'/cache/shiseido.html','utf8'),lily=JSON.parse(await readFile(out+'/cache/whitelily.json','utf8'))
 for(const s of records){
 s.matchedIds=[...new Set([...possibleExistingBranches(s,index),...db.filter(d=>normalizeAddress(d.address)===normalizeAddress(s.address)).map(d=>d.id)])]
 if(s.matchedIds.length){s.status='existing-or-identity-review';continue}
 if(s.chain_name!=='独立薬店'){s.status='official-chain-reconciliation-pending';pending.push(s);continue}
 try{
 let row
 if(s.name.includes('ハッピー堂')){
 if(!official.includes('ハッピー堂')||!official.includes(s.phone)||!official.includes('北海道網走市南五条西１－１０'))throw Error('Current manufacturer retailer details differ')
 row={...s,name:'ハッピー堂',officialPhoneSourceUrl:'https://www.shiseido.co.jp/sw/navi/shopdetail.html?shopCd=114094',officialOperatingEvidence:'Current Shiseido physical retailer details, address and telephone agree with government OTC permit snapshot',hours:'10:00–18:30（日曜定休）'}
 }else if(s.name==='松原薬粧'){
 const entry=lily.html.split('<li>').find(x=>x.includes('<h2>松原薬粧</h2>'))
 if(!entry?.includes(s.phone)||!entry.includes('斜里郡小清水町南町1丁目1-5'))throw Error('Current manufacturer retailer details differ')
 row={...s,officialPhoneSourceUrl:lily.url,officialOperatingEvidence:'Current White Lily physical retailer name, full street and telephone agree with government OTC permit snapshot'}
 }else throw Error('Old license snapshot requires current primary-source business identity')
 const url='https://www.google.com/maps?q='+encodeURIComponent(row.name+' '+row.address)+'&output=embed&hl=ja',file=out+'/cache/marker-'+s.id+'.json';let page
 try{page=JSON.parse(await readFile(file,'utf8'))}catch{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);page={url,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(page))}
 const marker=parseOfficialEmbedMarker(page.html,row);verifyMarkerAddress(marker,{...row,address:normalizeAddress(row.address)})
 if(db.some(d=>Math.hypot((d.lat-marker.lat)*111320,(d.lng-marker.lng)*111320*Math.cos(marker.lat*Math.PI/180))<60))throw Error('Existing nearby store requires identity review')
 stores.push(validateStore({...row,...marker,coordinateSourceUrl:url,coordinateCollectedAt:page.collectedAt}));s.status='verified-retail-candidate'
 }catch(e){s.status='pending-current-identity';pending.push({...s,reason:e.message})}
 }
 const report={at:new Date().toISOString(),databaseRows:db.length,licenseRows:records.length,existingOrReview:records.filter(s=>s.matchedIds.length).length,accepted:stores.length,pending:pending.length,nationalComplete:false,sourceCoverageComplete:false,limitations:['Only Abashiri public-health jurisdiction; old 2023-12-01 license snapshot','Current government permit and snapshot-to-today openings/closures unresolved','Other Hokkaido regional jurisdictions unresolved']}
 for(const [name,data]of Object.entries({'license-ledger':records,stores,pending,report}))await writeFile(out+'/'+name+'.json',JSON.stringify(data,null,2));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main()
