import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {databaseProcess} from './sync-sundrug.mjs'
import {normalizeAddress} from './crawl-eastern-license-registry.mjs'
import {normalizeIdentityText,indexExistingBranches,possibleExistingBranches} from './drugstore-identity.mjs'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-license-kyushu-2026-10-03'
const clean=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim().normalize('NFKC')
export function parseOkinawaPermitRows(rows){
 return rows.filter(r=>/^\d{10}$/.test(r[0]||'')).map(r=>{
  const name=String(r[1]).replaceAll('\n','').normalize('NFKC'),address=String(r[2]).replaceAll('\n','').normalize('NFKC')
  if(!address.startsWith('沖縄県'))throw Error('Permit address outside Okinawa')
  return {id:'license-okinawa-pref-'+createHash('sha256').update(r[0]+address+name).digest('hex').slice(0,16),name,address,pref:'沖縄県',chain_name:'独立薬店',phone:'',licenseNumber:r[0],licenseExpiry:r[4],licenseHolder:r[5],asOf:'2021-08-31',scope:'沖縄県（那覇市除外）',sourceUrl:'https://www.pref.okinawa.jp/_res/projects/default_project/_page_/001/005/306/tenpo202108.pdf',sourcePage:'https://www.pref.okinawa.jp/iryokenko/iryo/1005288/1005306.html'}
 })
}
export function parseKyushinTables(html){
 return [...html.matchAll(/<table id='table-01'>([\s\S]*?)<\/table>/g)].map(m=>{
  const t=m[1],name=clean(t.match(/class='tenmei1'>([\s\S]*?)<\/th>/)?.[1]),values=[...t.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x=>clean(x[1]))
  return {name,address:values[0]?.replace(/^〒\d{3}-\d{4}/,''),phone:values[1],hours:values[2],holiday:values[3],sourceUrl:'https://www.kyushin.co.jp/shoplists/'+t.match(/href='(storedata.html\?code=\d+)'/)?.[1]}
 }).filter(s=>s.name&&s.phone)
}
async function main(){
 await mkdir(out+'/cache',{recursive:true})
 const page=JSON.parse(await readFile(out+'/cache/kyushin-okinawa.json','utf8')),supplements=parseKyushinTables(page.html),ledger=parseOkinawaPermitRows(JSON.parse(await readFile(out+'/sources/okinawa-pref-202108.rows.json','utf8')))
 const raw=databaseProcess(process.env.AAPRICE_DB_URL,"\\pset tuples_only on\n\\pset format unaligned\nselect json_agg(s) from(select id,name,chain_name,address,pref,lat,lng from stores)s;"),db=JSON.parse(raw.slice(raw.indexOf('['))),review=indexExistingBranches(db)
 for(const row of ledger){row.matchedIds=[...new Set([...db.filter(s=>normalizeAddress(s.address)===normalizeAddress(row.address)||(s.pref===row.pref&&normalizeIdentityText(s.name)===normalizeIdentityText(row.name))).map(s=>s.id),...possibleExistingBranches(row,review)])];row.status=row.matchedIds.length?'existing-or-identity-review':!/薬|くすり|ドラッグ|漢方/.test(row.name)?'retail-format-review':/マツモト|モリ|イレブン|ココカラ|セガミ|ふく薬品|ヴァイン|ダイレックス|サンエー/.test(row.name)?'known-brand-review':'needs-current-retailer-evidence'}
 await writeFile(out+'/license-ledger.json',JSON.stringify(ledger,null,2));await writeFile(out+'/candidates.json',JSON.stringify(ledger.filter(s=>s.status==='needs-current-retailer-evidence'),null,2))
 const names=['新川薬品 野嵩店','タイヘイ薬品 普天間店','城間薬房','薬のふたば','有限会社タイヘイ薬品 中の町店','うさぎ薬品','タイヘイ薬品 北谷店','新川薬品 坂田店']
 const candidates=[],stores=[],pending=[]
 for(const supp of supplements.filter(s=>names.includes(s.name))){
  const key=normalizeIdentityText(supp.name.replace(/^有限会社/,'')),matches=ledger.filter(s=>normalizeIdentityText(s.name)===key)
  if(matches.length!==1)throw Error('Permit identity missing/ambiguous '+supp.name)
  const row={...matches[0],phone:supp.phone,retailerSourceUrl:supp.sourceUrl,retailerCollectedAt:page.collectedAt,hours:supp.hours+'（定休日：'+supp.holiday+'）'}
  if(row.name==='新川薬品 野嵩店'){row.retailerSourceUrl='https://arakawa-kampo.com/';row.hours='10:00–20:00（定休日：日曜・年末年始、来店は要予約）'}
  if(db.some(s=>normalizeAddress(s.address)===normalizeAddress(row.address)||(s.pref===row.pref&&normalizeIdentityText(s.name)===key))||possibleExistingBranches(row,review).length){pending.push({...row,reason:'existing-or-identity-review'});continue}
  candidates.push(row)
 }
 const near=(a,b)=>Math.hypot((a.lat-b.lat)*111320,(a.lng-b.lng)*111320*Math.cos(a.lat*Math.PI/180))<60
 for(const row of candidates){
  const url='https://www.google.com/maps?q='+encodeURIComponent(row.name+' '+row.address)+'&output=embed&hl=ja',file=out+'/cache/'+createHash('sha256').update(url).digest('hex')+'.json'
  try{let p;try{p=JSON.parse(await readFile(file,'utf8'))}catch{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);p={url,collectedAt:new Date().toISOString(),html:await r.text()};await writeFile(file,JSON.stringify(p))}
   const marker=parseOfficialEmbedMarker(p.html,row);verifyMarkerAddress(marker,{...row,address:normalizeAddress(row.address)})
   if(db.some(s=>near(marker,s))||stores.some(s=>near(marker,s)))throw Error('Nearby existing/staged store requires review')
   stores.push(validateStore({...row,...marker,coordinateSourceUrl:url,coordinateCollectedAt:p.collectedAt,coordinateEvidence:'Historical government OTC permit supplemented by current primary retailer/manufacturer name, phone and street; exact map entity identity and street matched'}))
  }catch(e){pending.push({...row,reason:e.message.split('\n')[0]})}
 }
 await writeFile(out+'/phone-supplements.json',JSON.stringify(supplements,null,2));await writeFile(out+'/stores.json',JSON.stringify(stores,null,2));await writeFile(out+'/pending.json',JSON.stringify(pending,null,2))
 const report={generatedAt:new Date().toISOString(),databaseRows:db.length,licenses:ledger.length,licenseAsOf:'2021-08-31',permitScope:'沖縄県（那覇市除外）',supplementedCandidates:candidates.length,accepted:stores.length,pending:pending.length,nationalComplete:false,sourceCoverageComplete:false,limitations:['2021 permit snapshot is historical, not evidence of present nationwide completeness','Other Kyushu jurisdictions and Naha full current source unresolved','License expiry does not establish closure or reopening']}
 await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main()
