import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {validateStore} from './crawl-national-stores.mjs'
import {parseWebsiteVerifiedMarker} from './official-embed-marker.mjs'

export function parseGenkyBusinessMarker(html,row){
  return {...parseWebsiteVerifiedMarker(html,row),coordinateEvidence:'Public business entity matched official branch name, company website, municipality and exact street numbers; corporate hotline not used as branch identity'}
}
async function main(){
  const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'artifacts/drugstores-genky-public-2026-10-03'
  const rows=JSON.parse(await readFile('artifacts/drugstores-genky-2026-10-03/pending.json','utf8'))
  const offline=process.argv.includes('--offline'),resume=process.argv.includes('--resume'),stores=[],pending=[],excluded=[]
  await mkdir(`${out}/cache`,{recursive:true})
  for(const row of rows){
    try{
      assert(row.name&&row.hours&&!/閉店|休業|予定|近日/.test(row.name),'Missing or inactive identity')
      const url=new URL('https://www.google.com/maps');url.search=new URLSearchParams({q:row.name+' '+row.address,output:'embed',hl:'ja'})
      const file=`${out}/cache/${createHash('sha256').update(url.href).digest('hex')}.json`
      let page
      try{const cached=JSON.parse(await readFile(file,'utf8'));if(offline||resume||Date.now()-Date.parse(cached.collectedAt)<86400000)page=cached}catch{}
      if(!page){
        assert(!offline,'Missing offline map observation')
        const response=await fetch(url,{signal:AbortSignal.timeout(25000)});assert(response.ok,`Public map HTTP ${response.status}`)
        page={url:url.href,collectedAt:new Date().toISOString(),html:await response.text()};await writeFile(file,JSON.stringify(page));await new Promise(r=>setTimeout(r,1000))
      }
      const {reason,directMarkerReason,...identity}=row
      stores.push(validateStore({...identity,...parseGenkyBusinessMarker(page.html,row),coordinateStatus:'verified-store-marker',coordinateAccuracy:'store-marker',coordinateSourceUrl:page.url,coordinateCollectedAt:page.collectedAt}))
    }catch(e){if(/inactive identity/.test(e.message))excluded.push({...row,reason:e.message});else pending.push({...row,reason:e.message})}
  }
  const report={generatedAt:new Date().toISOString(),discovered:rows.length,accepted:stores.length,pending:pending.length,excluded:excluded.length,enumerationComplete:true,applied:false}
  for(const [file,data] of Object.entries({'stores.json':stores,'pending.json':pending,'excluded.json':excluded,'report.json':report}))await writeFile(`${out}/${file}`,JSON.stringify(data,null,2))
  console.log(JSON.stringify(report))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1})
