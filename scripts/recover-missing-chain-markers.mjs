import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {parseOfficialEmbedMarker,parseWebsiteVerifiedMarker,verifyMarkerAddress} from './official-embed-marker.mjs'
import {validateStore} from './crawl-national-stores.mjs'

const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-komeya-recovery-2026-10-03'
const offline=process.argv.includes('--offline')
const rows=JSON.parse(await readFile('artifacts/drugstores-missing-chains-2026-10-03/pending.json','utf8')).filter(s=>s.id?.startsWith('komeya-'))
const stores=[],pending=[]
await mkdir(`${out}/cache`,{recursive:true})
for(const raw of rows){
  const row={...raw,address:raw.address.startsWith('石川県')?raw.address:'石川県'+raw.address}
  const name=row.name.split(/[＋+]/)[0].replace(/^ドラッグストア/,'').replace(/^コメヤ(?:薬局)?/,'')
  const url=new URL('https://www.google.com/maps');url.search=new URLSearchParams({q:row.name.split(/[＋+]/)[0]+' '+row.address,output:'embed',hl:'ja'})
  const file=`${out}/cache/${createHash('sha256').update(url.href).digest('hex')}.json`
  try{
    let page
    try{page=JSON.parse(await readFile(file,'utf8'))}catch{
      assert(!offline,'No cached public marker')
      const response=await fetch(url,{signal:AbortSignal.timeout(15000)});assert(response.ok,`HTTP ${response.status}`)
      page={url:url.href,collectedAt:new Date().toISOString(),html:await response.text()};await writeFile(file,JSON.stringify(page));await new Promise(r=>setTimeout(r,1000))
    }
    let marker
    try{marker=parseOfficialEmbedMarker(page.html,{...row,name})}catch{marker=parseWebsiteVerifiedMarker(page.html,{...row,name})}
    verifyMarkerAddress(marker,row)
    const {reason,...identity}=row
    stores.push(validateStore({...identity,...marker,coordinateStatus:'verified-store-marker',coordinateSourceUrl:page.url,coordinateCollectedAt:page.collectedAt,coordinateEvidence:'Public business marker matched official phone or website, branch, municipality and exact street numbers'}))
  }catch(e){pending.push({...row,reason:e.message})}
}
const report={generatedAt:new Date().toISOString(),discovered:rows.length,accepted:stores.length,pending:pending.length,enumerationComplete:true,applied:false}
for(const [file,data] of Object.entries({'stores.json':stores,'pending.json':pending,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
console.log(JSON.stringify(report))
