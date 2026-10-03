import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {parseOfficialEmbedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'
const out='artifacts/drugstores-additional-chains-2026-10-03'
const stores=JSON.parse(await readFile(`${out}/stores.json`,'utf8')),rows=JSON.parse(await readFile(`${out}/pending.json`,'utf8')),pending=[],recovered=[]
let previous=[];try{previous=JSON.parse(await readFile(`${out}/public-recovery-stores.json`,'utf8'))}catch{}
for(const raw of rows){
 const row={...raw,address:raw.chain_name==='シモカワ'&&!raw.address.startsWith('熊本県')?'熊本県'+raw.address:raw.address}
 const q=process.argv.includes('--phone-query')?`${row.name} ${row.phone}`:`${row.name} ${row.address.replace(/駅北口降りてすぐ！.*$/,'').trim()}`
 const url=`https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed&hl=ja`,file=`${out}/cache/public-${createHash('sha256').update(url).digest('hex')}.json`
 try{
  let page
  try{page=JSON.parse(await readFile(file,'utf8'))}catch{
   const response=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{'User-Agent':'AAPriceCatalog/1.0 (public drugstore directory)'}})
   if(!response.ok)throw Error(`Public map HTTP ${response.status}`)
   page={url,collectedAt:new Date().toISOString(),html:await response.text()};await writeFile(file,JSON.stringify(page))
  }
  const name=row.name.replace(/^くすりのダイイチ(?:薬局)?\s*|^同仁堂\s*|^ドラッグストア木のうた\s*|^シモカワ\s*|^(?:くすりのマルト|マルトパワードラッグ)\s*/,'')
  const marker=parseOfficialEmbedMarker(page.html,{...row,name})
  const official={...row,address:row.address.replace(/駅北口降りてすぐ！.*$/,'').trim()}
  verifyMarkerAddress(marker,official)
  const {reason,...s}=official
  const valid=validateStore({...s,...marker,coordinateEvidence:'Public Google Maps exact business entity; official branch name, telephone and street address verified',coordinateSourceUrl:url,coordinateCollectedAt:page.collectedAt,coordinateSourceType:'third-party-public-business-marker'})
  recovered.push(valid);stores.push(valid);console.log('accepted',row.name)
 }catch(e){pending.push({...row,publicMarkerAttemptUrl:url,publicMarkerFailure:e.message});console.log('pending',row.name,e.message.split('\n')[0])}
}
await writeFile(`${out}/public-recovery-stores.json`,JSON.stringify([...previous,...recovered],null,2))
await writeFile(`${out}/stores.json`,JSON.stringify(stores,null,2))
await writeFile(`${out}/pending.json`,JSON.stringify(pending,null,2))
const report=JSON.parse(await readFile(`${out}/report.json`,'utf8'));report.publicRecovery={attemptedThisRun:rows.length,recoveredThisRun:recovered.length,cumulativeRecovered:previous.length+recovered.length,pending:pending.length,generatedAt:new Date().toISOString()};report.accepted=stores.length;report.pending=pending.length
report.generatedAt=new Date().toISOString();for(const source of report.sources){source.accepted=stores.filter(s=>s.id?.startsWith(source.brand+'-')).length;source.pending=pending.filter(s=>s.id?.startsWith(source.brand+'-')).length}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2))
console.log(JSON.stringify(report.publicRecovery))
